import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveProjectRoot } from "../config/loader.js";
import type { DaemonStatusPayload, TunnelObservedStatus } from "../daemon/control.js";
import { writeRuntimeLog } from "../lib/runtime-log.js";
import {
    contactRunningController,
    ensureControllerRunning,
} from "../control/control.js";
import { addProject, getControlStatus, preferredRuntimeIntent, restartRuntime, stopRuntime } from "../control/services.js";
import {
    printInfo,
    printIntro,
    printOutro,
    printSuccess,
    printSummary,
    printWarning,
} from "../lib/util/terminal.js";
import { canonicalProjectPath } from "../projects/identity.js";
import { verifyRunningPublicRoute } from "../tunnel/setup-verify.js";
import type { CliFlags } from "./args.js";

/** Register the selected project first, then ensure the control plane and Runtime are ready. */
export async function ensureDaemonAndRegister(flags: CliFlags): Promise<void> {
    const projectRoot = resolveProjectRoot(flags.root);
    const registered = await addProject(projectRoot);
    const controller = await ensureControllerRunning();
    printInfo("Project registered. Preparing Runtime through the local Controller…");
    let result: Awaited<ReturnType<typeof controller.client.start>>;
    try {
        result = await controller.client.start({
            local: flags.local,
            noTunnel: flags.noTunnel,
            tunnelLogs: flags.tunnelLogs,
            intentSpecified: flags.runtimeIntentSpecified,
        });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${detail}\nProject registered. Open Web Console to continue: http://127.0.0.1:${controller.state.port}/`);
    }
    const status = result.status.runtime;
    if (!status) throw new Error("Runtime did not return status after startup");
    const canonicalRoot = canonicalProjectPath(projectRoot);
    const project = status.projects.find((item) => item.path === canonicalRoot) ?? registered;
    printRegistrationBanner(status, project, controller.state.port);
    writeRuntimeLog("info", "project_registered_cli", {
        project: project.id,
        daemonPid: status.pid,
        controllerPid: controller.state.pid,
    });
}

/** Ensure the persistent local control plane exists and open its Web Console. */
export async function runOpen(): Promise<void> {
    const controller = await ensureControllerRunning();
    const url = `http://127.0.0.1:${controller.state.port}/`;
    printSuccess(`Web Console: ${url}`);
    if (process.env.CODEX_MCP_NO_BROWSER === "1") return;
    tryOpenBrowser(url);
}

export async function runStatus(flags: CliFlags): Promise<void> {
    const cliVersion = getPackageVersion();
    const controller = await contactRunningController();
    const controllerStatus = controller ? await controller.client.status() : undefined;
    const control = controllerStatus?.runtime ?? await getControlStatus();
    const status = control.runtime;
    const preferredIntent = preferredRuntimeIntent();
    const daemonVersion = status?.version ?? null;
    const versionMismatch = Boolean(
        (daemonVersion && daemonVersion !== cliVersion) ||
        (controllerStatus && controllerStatus.version !== cliVersion),
    );
    const controllerJson = controllerStatus ? {
        apiVersion: controllerStatus.apiVersion,
        pid: controllerStatus.pid,
        version: controllerStatus.version,
        startedAt: controllerStatus.startedAt,
        uptimeMs: controllerStatus.uptimeMs,
        panelUrl: controllerStatus.panelUrl,
    } : null;

    if (flags.json) {
        console.log(JSON.stringify({
            schemaVersion: 1,
            running: control.running,
            cliVersion,
            daemonVersion,
            versionMismatch,
            preferredRuntimeIntent: preferredIntent,
            controller: controllerJson,
            daemon: status ? {
                controlApiVersion: status.controlApiVersion,
                pid: status.pid,
                mode: status.mode,
                startedAt: status.startedAt,
                uptimeMs: status.uptimeMs,
                localUrl: status.localUrl,
                publicMcpUrl: status.publicMcpUrl ?? null,
                runtimeIntent: status.runtimeIntent,
                tunnelRunning: status.tunnel.running,
                tunnel: status.tunnel,
                auth: status.auth,
            } : null,
            projects: control.projects,
        }, null, 2));
        return;
    }

    printIntro("codex-mcp status");
    if (!status) {
        printWarning("MCP Runtime is not running.");
        if (controllerStatus) {
            printInfo(`Local Controller is still running: pid ${controllerStatus.pid} · ${controllerStatus.panelUrl}`);
        } else {
            printInfo("Local Controller is stopped. Run codex-mcp open to open the console, or codex-mcp start to start the current project.");
        }
        printInfo(`Next startup mode: ${describeRuntimeIntent(preferredIntent)}`);
        if (control.projects.length > 0) {
            printInfo(`Saved ${control.projects.length} project registrations; they will be available when Runtime starts.`);
        }
        printOutro("Status check complete");
        return;
    }

    printSummary("Local control plane", [
        { label: "Controller", value: controllerStatus ? `pid ${controllerStatus.pid} · ${controllerStatus.version}` : "Stopped" },
        { label: "Web Console", value: controllerStatus?.panelUrl ?? "Stopped" },
        { label: "Runtime", value: `pid ${status.pid} · ${status.mode === "local" ? "Local" : "Public"}` },
        { label: "Default startup", value: describeRuntimeIntent(preferredIntent) },
        { label: "Uptime", value: formatUptime(status.uptimeMs) },
        { label: "CLI Version", value: cliVersion },
        { label: "Runtime Version", value: status.version },
        { label: "Local MCP", value: status.localUrl },
        { label: "OAuth", value: status.auth.required ? (status.auth.configured ? "Configured" : "Not configured") : "Disabled" },
        { label: "Public address", value: status.publicMcpUrl ?? "Disabled" },
        { label: "Public connection", value: describeTunnelStatus(status.tunnel) },
    ]);

    if (versionMismatch) {
        printWarning("CLI, Controller, or Runtime versions differ. Run codex-mcp update, then codex-mcp restart." );
    }

    const active = status.projects.filter((item) => item.active);
    if (status.projects.length === 0) {
        printInfo("No projects registered. Run codex-mcp start in a project directory to register one.");
    } else {
        printInfo("Registered projects: ");
        for (const item of status.projects) {
            printInfo(`- ${item.name}${item.active ? "" : " (Inactive)"} ${item.path} · ${item.boundSessions} session bindings`);
        }
        if (active.length === 0) printWarning("No active projects. Run codex-mcp project add [directory] to reactivate one.");
    }

    if (status.publicMcpUrl && !(await checkPublicHealthz(status.localUrl, status.publicMcpUrl))) {
        printWarning(`Cannot verify the public address (${status.publicMcpUrl}). Run codex-mcp doctor to check public access.`);
    }
    printOutro("Status check complete");
}

/** Stop only the MCP Runtime; the persistent local Controller and Web Console stay online. */
export async function runStop(): Promise<void> {
    const controller = await contactRunningController();
    printInfo("Stopping MCP Runtime, including Tunnel, managed processes, and the MCP service…");
    if (!controller) {
        const stopped = await stopRuntime();
        if (!stopped) {
            printWarning("MCP Runtime is not running; the local Controller is also stopped.");
            return;
        }
        printSuccess("MCP Runtime stopped; project registrations preserved. Controller was not running.");
        return;
    }
    const result = await controller.client.stop();
    if (!result.stopped) {
        printWarning("MCP Runtime is not running; the local Controller remains online.");
        return;
    }
    printSuccess(`MCP Runtime stopped; project registrations preserved. Web Console: http://127.0.0.1:${controller.state.port}/`);
}

/** Stop the whole local control plane, including any running Runtime. */
export async function runShutdown(): Promise<void> {
    const controller = await contactRunningController();
    if (!controller) {
        const control = await getControlStatus();
        if (control.running) {
            await stopRuntime();
            printSuccess("MCP Runtime stopped; no Controller is running.");
        } else {
            printWarning("Controller and MCP Runtime are both stopped.");
        }
        return;
    }
    printInfo("Shutting down MCP Runtime and the local Controller…");
    await controller.client.shutdown();
    await waitForProcessExit(controller.state.pid, 30_000);
    printSuccess("codex-mcp shut down.");
}

/** Restart a running Runtime in the same mode through the persistent Controller. */
export async function runRestart(): Promise<void> {
    const existing = await contactRunningController();
    printInfo("Restarting Runtime with its previous settings…");
    const control = existing
        ? (await (await ensureControllerRunning()).client.restart()).status
        : await restartRuntime();
    const status = control.runtime;
    if (!status) throw new Error("Runtime did not return status after restart");
    printSuccess(`Runtime restarted: pid ${status.pid} · ${status.version} · ${status.projects.filter((item) => item.active).length} active projects.`);
}

export function getPackageVersion(): string {
    try {
        const raw = JSON.parse(
            readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
        ) as { version?: unknown };
        return typeof raw.version === "string" ? raw.version : "Unknown version";
    } catch {
        return "Unknown version";
    }
}

function printRegistrationBanner(
    status: DaemonStatusPayload,
    project: { id: string; name: string; path: string },
    controllerPort: number,
): void {
    printIntro("codex-mcp");
    printSummary("Ready", [
        { label: "MCP Runtime", value: `pid ${status.pid} · uptime ${formatUptime(status.uptimeMs)}` },
        { label: "Run mode", value: status.mode === "local" ? "Local only" : "Public" },
        { label: "Local address", value: status.localUrl },
        { label: "Web Console", value: `http://127.0.0.1:${controllerPort}/` },
        { label: "Public address", value: status.publicMcpUrl ?? "Disabled" },
        { label: "Current project", value: project.name },
        { label: "Registered projects", value: `${status.projects.length} items` },
    ]);
    printInfo(`Tell ChatGPT to switch to project ${project.name} to get started.`);
    printOutro("Manage and troubleshoot: codex-mcp open · Stop service: codex-mcp stop");
}

function formatUptime(uptimeMs: number): string {
    const seconds = Math.floor(uptimeMs / 1000);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} m ${seconds % 60} s`;
    const hours = Math.floor(minutes / 60);
    return `${hours} h ${minutes % 60} m`;
}

async function checkPublicHealthz(
    localMcpUrl: string,
    publicMcpUrl: string,
): Promise<boolean> {
    try {
        const local = new URL(localMcpUrl);
        await verifyRunningPublicRoute(new URL(publicMcpUrl).hostname, local.hostname, Number(local.port));
        return true;
    } catch {
        return false;
    }
}

function describeRuntimeIntent(intent: { local: boolean; noTunnel: boolean; tunnelLogs: boolean }): string {
    if (intent.local) return "Local mode";
    return intent.noTunnel ? "Public mode (external ingress)" : "Public mode (managed Tunnel)";
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            process.kill(pid, 0);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
            if ((error as NodeJS.ErrnoException).code !== "EPERM") return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Controller pid ${pid} did not exit within ${timeoutMs}ms`);
}

function tryOpenBrowser(url: string): void {
    const command = process.platform === "darwin"
        ? { bin: "open", args: [url] }
        : process.platform === "win32"
          ? { bin: "cmd.exe", args: ["/c", "start", "", url] }
          : { bin: "xdg-open", args: [url] };
    try {
        const child = spawn(command.bin, command.args, {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
        });
        child.once("error", () => undefined);
        child.unref();
    } catch {
        printInfo("The browser did not open automatically. Copy the Web Console address above.");
    }
}

function describeTunnelStatus(status: TunnelObservedStatus): string {
    if (status.state === "off") return "Unmanaged";
    if (status.state === "connected") return status.restartCount
        ? `Connected · ${status.restartCount} restarts`
        : "Connected";
    const labels = {
        starting: "Connecting",
        degraded: "Connection degraded",
        exited: "Connection exited",
    } as const;
    return `${labels[status.state]}${status.detail ? ` · ${status.detail}` : ""}`;
}
