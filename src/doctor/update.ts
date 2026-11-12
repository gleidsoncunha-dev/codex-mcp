import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { printInfo } from "../lib/util/terminal.js";
import { terminateChildProcess } from "../lib/process/tree.js";

export interface UpdateInstallerInvocation {
    file: string;
    args: string[];
    scriptPath: string;
}

export function getUpdateInstallerInvocation(
    platform: NodeJS.Platform = process.platform,
): UpdateInstallerInvocation {
    if (platform === "win32") {
        const scriptPath = fileURLToPath(new URL("../../scripts/install.ps1", import.meta.url));
        return {
            file: "powershell.exe",
            args: [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                scriptPath,
            ],
            scriptPath,
        };
    }

    if (platform === "darwin" || platform === "linux") {
        const scriptPath = fileURLToPath(new URL("../../scripts/install.sh", import.meta.url));
        return {
            file: "sh",
            args: [scriptPath],
            scriptPath,
        };
    }

    throw new Error(`Automatic updates are not supported on this system: ${platform}`);
}

export interface SelfUpdateOptions {
    signal?: AbortSignal;
    onOutput?: (text: string) => void;
}

export async function runSelfUpdate(options: SelfUpdateOptions = {}): Promise<void> {
    const invocation = getUpdateInstallerInvocation();
    try {
        await access(invocation.scriptPath);
    } catch {
        throw new Error(
            "This installation is missing the updater. Rerun the installation script to enable `codex-mcp update`.",
        );
    }

    options.signal?.throwIfAborted();
    printInfo("Checking for and installing the latest codex-mcp…");
    const exitCode = await runInstaller(invocation, options);
    if (exitCode !== 0) {
        throw new Error(`Update incomplete (exit code ${exitCode})`);
    }
}

async function runInstaller(invocation: UpdateInstallerInvocation, options: SelfUpdateOptions): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        const captureOutput = options.onOutput !== undefined;
        const child = spawn(invocation.file, invocation.args, {
            env: {
                ...process.env,
                CODEX_MCP_UPDATE: "1",
            },
            stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
            windowsHide: false,
            shell: false,
        });
        let settled = false;
        const finishReject = (error: unknown): void => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        const onAbort = (): void => {
            void terminateChildProcess(child, 5_000, 2_000).finally(() => {
                finishReject(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Update cancelled"));
            });
        };
        if (captureOutput) {
            child.stdout?.on("data", (chunk) => options.onOutput?.(chunk.toString()));
            child.stderr?.on("data", (chunk) => options.onOutput?.(chunk.toString()));
        }
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener("abort", onAbort, { once: true });
        child.once("error", finishReject);
        child.once("close", (code) => {
            options.signal?.removeEventListener("abort", onAbort);
            if (settled) return;
            settled = true;
            resolve(code ?? 1);
        });
    });
}
