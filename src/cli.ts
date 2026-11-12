#!/usr/bin/env node
import { loadConfig, type ServerConfig } from "./config/loader.js";
import type { DoctorLevel } from "./doctor/index.js";
import { DownstreamMcpHub } from "./downstream/hub.js";
import { CapabilityManager } from "./capabilities/manager.js";
import { CapabilityWatcher } from "./capabilities/runtime.js";
import type { SkillRegistry } from "./skills/registry.js";
import { resolveAllowedTools } from "./capabilities/policy.js";
import { createHttpServer } from "./server/http-server.js";
import {
    closeRuntimeLog,
    initializeRuntimeLog,
    writeRuntimeLog,
} from "./lib/runtime-log.js";
import {
    printError,
    printInfo,
    printIntro,
    printNote,
    printOutro,
    printSuccess,
    printWarning,
} from "./lib/util/terminal.js";
import {
    CloudflaredSidecar,
    type TunnelSidecarStatus,
} from "./tunnel/sidecar.js";
import { verifyTunnelRoute } from "./tunnel/verify.js";
import {
    loadCommittedTunnelSetup,
    type TunnelSetupResult,
} from "./tunnel/setup.js";
import { loadUserConfig } from "./config/user-config.js";
import { randomBytes } from "node:crypto";
import type { TunnelObservedStatus } from "./daemon/control.js";
import {
    loadDaemonState,
    removeDaemonState,
    saveDaemonState,
} from "./daemon/state.js";
import { BindingStore } from "./projects/bindings.js";
import { ProjectRegistry } from "./projects/registry.js";
import { ProjectRuntimeManager } from "./projects/runtime.js";
import { PACKAGE_VERSION } from "./server/version.js";
import { parseCliArgs, type CliFlags } from "./cli/args.js";
import { followLogFile, readRecentLogLines } from "./cli/logs.js";
import {
    configureAdminPassword,
    ensureAdminPasswordConfigured,
    runFirstTimeSetup,
} from "./cli/setup-commands.js";
import {
    ensureDaemonAndRegister,
    getPackageVersion,
    runOpen,
    runRestart,
    runShutdown,
    runStatus,
    runStop,
} from "./cli/daemon-commands.js";
import { runBindingsCommand, runProjectCommand } from "./cli/project-commands.js";
import { runControllerProcess } from "./control/process.js";
import { runDoctorService, selfUpdate } from "./control/services.js";

/** Print CLI usage. */
function printUsage(): void {
    printIntro("codex-mcp");
    printNote(
        "Common commands",
        [
            "codex-mcp start                   Register the current project and ensure the background service is running",
            "codex-mcp open                    Open the local Web Console without starting Runtime",
            "codex-mcp status                  Show control plane, Runtime, Tunnel, and project status",
            "codex-mcp restart                 Restart MCP Runtime and keep project registrations",
            "codex-mcp stop                    Stop MCP Runtime; keep Web Console running",
            "codex-mcp shutdown                Shut down Runtime and Web Console",
            "codex-mcp project list            List registered projects",
            "codex-mcp project add [directory]      Register a project (current directory by default)",
            "codex-mcp project remove [project]   Deactivate a project (current directory by default)",
            "codex-mcp project info [project]     Show project details",
            "codex-mcp bindings clean [project]   Clear project session bindings",
            "codex-mcp logs [--lines N]        Show recent runtime logs",
            "codex-mcp logs -f                 Follow runtime logs",
            "codex-mcp setup                   Set up or manage public access",
            "codex-mcp doctor [--fix]          Check configuration; --fix performs safe local repairs only",
            "codex-mcp auth                    Change connection password",
            "codex-mcp update                  Update to the latest version",
        ].join("\n"),
    );
    printNote(
        "Other",
        [
            "codex-mcp status --json           Output machine-readable status",
            "codex-mcp start --local           Register the current project and switch to local mode",
            "codex-mcp start --public          Register the current project and switch to public mode",
            "codex-mcp start --root <directory>     Specify the project directory for start",
            "codex-mcp --version               Show version",
        ].join("\n"),
    );
    printInfo("Usually, run codex-mcp start in a project directory. Run codex-mcp open for the graphical interface.");
    printOutro("Without public access configured, start defaults to local mode. To connect ChatGPT, run setup or configure Web Console.");
}

/**
 * CLI entrypoint.
 *
 * @param argv - Process arguments excluding node/executable
 */
async function main(argv: string[]): Promise<void> {
    const flags = parseCliArgs(argv);
    if (flags.command === "help") {
        printUsage();
        return;
    }

    if (flags.command === "version") {
        console.log(getPackageVersion());
        return;
    }

    if (flags.command === "doctor") {
        await printDoctorReport(flags.fix);
        return;
    }

    if (flags.command === "setup") {
        await runFirstTimeSetup();
        return;
    }

    if (flags.command === "auth") {
        await configureAdminPassword();
        return;
    }

    if (flags.command === "update") {
        await selfUpdate();
        return;
    }

    if (flags.command === "status") {
        await runStatus(flags);
        return;
    }

    if (flags.command === "open") {
        await runOpen();
        return;
    }

    if (flags.command === "stop") {
        await runStop();
        return;
    }

    if (flags.command === "shutdown") {
        await runShutdown();
        return;
    }

    if (flags.command === "restart") {
        await runRestart();
        return;
    }

    if (flags.command === "logs") {
        await runLogs(flags);
        return;
    }

    if (flags.command === "project") {
        await runProjectCommand(flags);
        return;
    }

    if (flags.command === "bindings") {
        await runBindingsCommand(flags);
        return;
    }

    if (flags.command === "daemon") {
        await runDaemonProcess(flags);
        return;
    }

    if (flags.command === "controller") {
        await runControllerProcess();
        return;
    }

    await runStart(flags);
}

/** Ensure the daemon is running, register the current project, and print status. */
async function runStart(flags: CliFlags): Promise<void> {
    await ensureDaemonAndRegister(flags);
}

interface StartedServices {
    config: ServerConfig;
    server: ReturnType<typeof createHttpServer>;
    hub: DownstreamMcpHub;
    skills: SkillRegistry;
    capabilityWatcher: CapabilityWatcher;
    sidecar?: CloudflaredSidecar;
    tunnelReady?: { protocol?: string; location?: string };
    logDirectory?: string;
    userConfig: ReturnType<typeof loadUserConfig>;
}

interface DaemonStartContext {
    registry: ProjectRegistry;
    bindings: BindingStore;
    runtimes: ProjectRuntimeManager;
    controlToken: string;
    runtimeIntent: { local: boolean; noTunnel: boolean; tunnelLogs: boolean };
    onShutdown: () => Promise<void>;
}

interface StartServicesOptions {
    signal: AbortSignal;
    flags: CliFlags;
    userConfig: ReturnType<typeof loadUserConfig>;
    daemon?: DaemonStartContext;
    tunnelStatus: () => TunnelObservedStatus;
    onTunnelStatus: (status: TunnelSidecarStatus) => void;
}

async function cleanupStartedResources(
    server: ReturnType<typeof createHttpServer>,
    capabilityWatcher?: CapabilityWatcher,
    sidecar?: CloudflaredSidecar,
): Promise<unknown[]> {
    const errors: unknown[] = [];
    try {
        capabilityWatcher?.close();
    } catch (error) {
        errors.push(error);
    }
    if (sidecar) {
        try {
            await sidecar.stop();
        } catch (error) {
            errors.push(error);
        }
    }
    try {
        await server.close();
    } catch (error) {
        errors.push(error);
    }
    return errors;
}

function startupCleanupError(original: unknown, cleanupErrors: unknown[]): unknown {
    return cleanupErrors.length === 0
        ? original
        : new AggregateError(
              [original, ...cleanupErrors],
              `Startup failed; cleanup of ${cleanupErrors.length} local resources is incomplete`,
          );
}

/**
 * Start the HTTP MCP server plus the shared hub/skills/watcher, and optionally
 * the Cloudflare sidecar. Used by the internal daemon.
 */
async function startServices(options: StartServicesOptions): Promise<StartedServices> {
    const { flags, userConfig, signal } = options;
    signal.throwIfAborted();
    const allowSidecar = !flags.local && !flags.noTunnel;

    const config = loadConfig({
        projectRoot: flags.root,
        userConfig,
        local: flags.local,
    });

    if (!flags.local && config.allowedHosts.length === 0) {
        throw new Error("Public address is not set. Run `codex-mcp setup`, or use `codex-mcp start --local` for local access only");
    }

    let logDirectory: string | undefined;
    try {
        const info = await initializeRuntimeLog({
            onError: (error) => {
                printWarning(`File logging stopped: ${error.message}`);
            },
        });
        logDirectory = info.directory;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        printWarning(`File logging unavailable; the service will continue starting: ${detail}`);
    }

    let tunnelSetup: TunnelSetupResult | undefined;
    const wantSidecar =
        allowSidecar && userConfig.publicAccess?.kind === "cloudflare";
    if (wantSidecar) {
        tunnelSetup = await loadCommittedTunnelSetup(userConfig, config.host, config.port);
    }

    const capabilities = new CapabilityManager(
        config.projectRoot,
        options.daemon
            ? {
                  includeUserScopes: true,
                  includeProjectScopes: false,
              }
            : {},
    );
    const hub = await DownstreamMcpHub.connectFromDefaultConfig({
        loadConfig: () => capabilities.loadMcpConfig(),
    });
    if (hub.getImportError()) {
        printWarning(`Failed to load external MCP configuration; core services will continue starting: ${hub.getImportError()}`);
    }
    const skills = capabilities.createSkillRegistry();
    for (const diagnostic of capabilities.getDiagnostics(skills)) {
        for (const warning of diagnostic.warnings) {
            printWarning(`${diagnostic.source} capability source: ${warning}`);
        }
    }
    const server = createHttpServer(config, {
        hub,
        skills,
        capabilities,
        allowedToolsResolver: resolveAllowedTools,
        ...(options.daemon
            ? {
                  daemon: {
                      registry: options.daemon.registry,
                      bindings: options.daemon.bindings,
                      runtimes: options.daemon.runtimes,
                      controlToken: options.daemon.controlToken,
                      runtimeIntent: options.daemon.runtimeIntent,
                      tunnelStatus: options.tunnelStatus,
                      onShutdown: options.daemon.onShutdown,
                  },
              }
            : {}),
    });
    let capabilityWatcher: CapabilityWatcher | undefined;
    let sidecar: CloudflaredSidecar | undefined;
    let tunnelReady: { protocol?: string; location?: string } | undefined;
    const publicUrl =
        config.allowedHosts[0] !== undefined
            ? `https://${config.allowedHosts[0]}/mcp`
            : undefined;

    const cancelSidecar = () => { void sidecar?.stop().catch(() => undefined); };
    signal.addEventListener("abort", cancelSidecar, { once: true });
    try {
        signal.throwIfAborted();
        await server.listen();
        signal.throwIfAborted();
        capabilityWatcher = new CapabilityWatcher(capabilities, hub, skills);
        capabilityWatcher.start();
        if (
            tunnelSetup?.useCloudflared &&
            tunnelSetup.bin &&
            tunnelSetup.tunnelId &&
            tunnelSetup.configPath
        ) {
            sidecar = new CloudflaredSidecar({
                bin: tunnelSetup.bin,
                tunnelId: tunnelSetup.tunnelId,
                configPath: tunnelSetup.configPath,
                mirrorLogs: flags.tunnelLogs,
                maxRestarts: options.daemon ? 3 : 0,
                onStateChange: options.onTunnelStatus,
            });
            tunnelReady = await sidecar.start();
            signal.throwIfAborted();
        }
        if (publicUrl) {
            await verifyTunnelRoute(publicUrl, server.getTunnelProbe(), { signal });
        }
    } catch (error) {
        const cleanupErrors = await cleanupStartedResources(server, capabilityWatcher, sidecar);
        throw startupCleanupError(error, cleanupErrors);
    } finally {
        signal.removeEventListener("abort", cancelSidecar);
    }

    if (!capabilityWatcher) throw new Error("Capability watcher did not start");
    return { config, server, hub, skills, capabilityWatcher, sidecar, tunnelReady, logDirectory, userConfig };
}

/**
 * Internal daemon entrypoint (spawned detached by the CLI). Owns the MCP
 * server, the Cloudflare sidecar, and the durable daemon state.
 */
async function runDaemonProcess(flags: CliFlags): Promise<void> {
    if (typeof process.send !== "function" || !process.connected) {
        throw new Error("daemon is an internal entry point; run codex-mcp start");
    }
    const startup = new AbortController();
    const cancel = () => startup.abort(new Error("Daemon startup cancelled"));
    // Keep IPC ownership until state is committed. If the starting CLI dies,
    // an unfinished daemon must clean up instead of becoming an orphan.
    process.once("disconnect", cancel);
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    const release = () => {
        process.off("disconnect", cancel);
        process.off("SIGINT", cancel);
        process.off("SIGTERM", cancel);
    };
    try {
        await runDaemonServices(flags, startup.signal, () => {
            release();
            if (process.connected) process.disconnect();
        });
    } finally {
        release();
    }
}

async function runDaemonServices(flags: CliFlags, signal: AbortSignal, ready: () => void): Promise<void> {
    const userConfig = loadUserConfig();
    if (!flags.local && !userConfig.publicAccess) {
        throw new Error("daemon only reads committed configuration; run `codex-mcp setup` in the foreground first");
    }

    if (!flags.local) {
        await ensureAdminPasswordConfigured();
    }

    const registry = new ProjectRegistry();
    const bindings = new BindingStore();
    await bindings.pruneStale();
    const runtimes = new ProjectRuntimeManager();
    const controlToken = randomBytes(32).toString("base64url");

    let services: StartedServices | undefined;
    let tunnelStatus: TunnelObservedStatus = { running: false, state: "off" };
    let shuttingDown = false;

    const shutdown = async (): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        writeRuntimeLog("info", "daemon_stopping");
        let exitCode = 0;
        try {
            if (services) {
                const errors = await cleanupStartedResources(services.server, services.capabilityWatcher, services.sidecar);
                if (errors.length) throw new AggregateError(errors, "Background service cleanup incomplete");
            }
            await removeDaemonState();
            writeRuntimeLog("info", "daemon_stopped");
        } catch (error) {
            exitCode = 1;
            writeRuntimeLog("error", "daemon_stop_failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            try {
                closeRuntimeLog();
            } catch {
                // best effort
            }
            process.exit(exitCode);
        }
    };

    services = await startServices({
        signal,
        flags,
        userConfig,
        daemon: {
            registry,
            bindings,
            runtimes,
            controlToken,
            runtimeIntent: {
                local: flags.local,
                noTunnel: flags.noTunnel,
                tunnelLogs: flags.tunnelLogs,
            },
            onShutdown: shutdown,
        },
        tunnelStatus: () => tunnelStatus,
        onTunnelStatus: (status) => {
            tunnelStatus = status;
        },
    });

    try {
        signal.throwIfAborted();
        await saveDaemonState({
            schemaVersion: 1,
            pid: process.pid,
            host: services.config.host,
            port: services.server.getPort(),
            controlToken,
            ...(services.config.publicMcpUrl ? { publicMcpUrl: services.config.publicMcpUrl } : {}),
            startedAt: new Date().toISOString(),
            version: PACKAGE_VERSION,
            runtimeIntent: {
                local: flags.local,
                noTunnel: flags.noTunnel,
                tunnelLogs: flags.tunnelLogs,
            },
        });
        signal.throwIfAborted();
    } catch (error) {
        if (loadDaemonState()?.pid === process.pid) await removeDaemonState();
        const cleanupErrors = await cleanupStartedResources(
            services.server,
            services.capabilityWatcher,
            services.sidecar,
        );
        try {
            closeRuntimeLog();
        } catch (logError) {
            cleanupErrors.push(logError);
        }
        throw startupCleanupError(error, cleanupErrors);
    }
    writeRuntimeLog("info", "daemon_started", {
        pid: process.pid,
        mode: flags.local ? "local" : "public",
        tunnel: services.sidecar !== undefined,
    });

    process.once("SIGINT", () => {
        void shutdown();
    });
    process.once("SIGTERM", () => {
        void shutdown();
    });
    ready();
}

async function runLogs(flags: CliFlags): Promise<void> {
    const recent = readRecentLogLines(flags.lines);
    if (!recent.text) {
        if (flags.follow) {
            throw new Error(`No runtime logs yet: ${recent.path}`);
        }
        printWarning(`No runtime logs yet: ${recent.path}`);
        return;
    }
    process.stdout.write(`${recent.text}\n`);
    if (flags.follow) {
        await followLogFile(recent.path);
    }
}

/** Print installation/configuration report; --fix only performs whitelisted local repairs. */
async function printDoctorReport(fix: boolean): Promise<void> {
    printIntro("codex-mcp checks");

    const result = await runDoctorService(fix);
    for (const fixMessage of result.fixes) printSuccess(fixMessage);
    for (const warning of result.warnings) printWarning(warning);
    if (fix) printInfo("--fix does not modify Cloudflare DNS, OAuth identities, connection passwords, or project files.");

    const report = result.report;
    for (const check of report.checks) {
        printDoctorMessage(check.level, `${check.label}: ${check.detail}`);
    }

    if (report.errors > 0) {
        process.exitCode = 1;
        printError(
            `Found ${report.errors} issues that need attention. Follow the instructions above, then run codex-mcp doctor again.`,
        );
    } else if (report.warnings > 0) {
        printWarning(`Ready to use, with ${report.warnings} warnings to review.`);
    } else {
        printSuccess("Installation and configuration look healthy.");
    }
    printInfo("Starting codex-mcp also checks that public access is actually available.");
    printOutro("Checks complete");
}

function printDoctorMessage(level: DoctorLevel, text: string): void {
    if (level === "ok") {
        printSuccess(text);
    } else if (level === "warn") {
        printWarning(text);
    } else {
        printError(text);
    }
}

void main(process.argv.slice(2)).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    writeRuntimeLog("error", "startup_failed", { error: detail });
    printError(detail);
    try {
        closeRuntimeLog();
    } catch (logError) {
        const logDetail = logError instanceof Error ? logError.message : String(logError);
        printWarning(`Failed to close file log: ${logDetail}`);
    }
    process.exit(1);
});
