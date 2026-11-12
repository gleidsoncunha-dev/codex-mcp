import { accessSync, constants, existsSync } from "node:fs";
import { hasAdminPassword } from "../auth/password-store.js";
import { findRipgrep } from "../lib/search/ripgrep.js";
import { runSubprocess } from "../lib/util/subprocess.js";
import { suggestCloudflaredBin, probeCloudflaredVersion } from "../tunnel/bin.js";
import {
    getCloudflareOriginCertPath,
    hasManagedCloudflareLogin,
    readManagedCloudflareOriginToken,
    readTunnelCredentialIdentity,
} from "../tunnel/cloudflare-account.js";
import { getCredentialsPath, resolveCloudflaredRuntimeConfigPath } from "../tunnel/yml.js";
import { getUserConfigPath, loadUserConfig } from "../config/user-config.js";
import { describeEnabledCapabilitySources, resolveCapabilitiesConfig } from "../capabilities/config.js";
import { dnsSnapshotPointsToTunnel, inspectCloudflareTunnel, snapshotCloudflareDns } from "../tunnel/cloudflare-api.js";
import { contactRunningDaemon } from "../daemon/control.js";
import { loadCommittedTunnelSetup } from "../tunnel/setup.js";
import { verifyRunningPublicRoute } from "../tunnel/setup-verify.js";

export type DoctorLevel = "ok" | "warn" | "error";

export interface DoctorCheck {
    label: string;
    level: DoctorLevel;
    detail: string;
}

export interface DoctorReport {
    checks: DoctorCheck[];
    errors: number;
    warnings: number;
}

export async function runDoctorChecks(): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [];

    const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    checks.push({
        label: "Node.js",
        level: nodeMajor >= 22 ? "ok" : "error",
        detail:
            nodeMajor >= 22
                ? `Version ${process.versions.node}`
                : `Current version is ${process.versions.node}; Node 22 or later is required`,
    });

    checks.push(await checkCommand("Git", "git", ["--version"], false));
    checks.push(await checkRipgrep());

    let userConfig: ReturnType<typeof loadUserConfig> | undefined;
    try {
        userConfig = loadUserConfig();
        checks.push({
            label: "Configuration file",
            level: existsSync(getUserConfigPath()) ? "ok" : "warn",
            detail: existsSync(getUserConfigPath())
                ? getUserConfigPath()
                : "Not configured yet. Run `codex-mcp setup`",
        });
    } catch (error) {
        checks.push({
            label: "Configuration file",
            level: "error",
            detail: readableError(error),
        });
    }

    const capabilityConfig = resolveCapabilitiesConfig(userConfig?.capabilities);
    checks.push({
        label: "External capabilities",
        level: "ok",
        detail: `${describeEnabledCapabilitySources(capabilityConfig)} · ${capabilityConfig.sync === "watch" ? "Automatic sync" : "Read at startup"}`,
    });
    if (capabilityConfig.sources.codex.mcp) {
        checks.push(await checkCommand("Codex", "codex", ["--version"], false));
    }

    const publicAccess = userConfig?.publicAccess;
    const publicModeExpected = userConfig?.runtime?.mode === "public" || publicAccess !== undefined;
    try {
        const configured = await hasAdminPassword();
        checks.push({
            label: "Connection password",
            level: configured ? "ok" : publicModeExpected ? "error" : "warn",
            detail: configured
                ? "Set"
                : publicModeExpected
                  ? "Not set; public access requires a connection password. Set it on the Connection page in Web Console or run `codex-mcp auth`"
                  : "Not set; local-only mode does not require it. Set it when connecting ChatGPT",
        });
    } catch (error) {
        checks.push({
            label: "Connection password",
            level: "error",
            detail: readableError(error),
        });
    }

    if (publicAccess) {
        checks.push({
            label: "Public address",
            level: "ok",
            detail: `https://${publicAccess.domain}/mcp`,
        });
    } else {
        checks.push({
            label: "Public address",
            level: userConfig?.runtime?.mode === "public" ? "error" : "warn",
            detail: userConfig?.runtime?.mode === "public"
                ? "Not set; public mode is the startup default. Configure it on the Connection page in Web Console or run `codex-mcp setup`"
                : "Not set; local-only mode is available. Configure this when connecting ChatGPT",
        });
    }

    if (publicAccess?.kind === "external") {
        checks.push({
            label: "Cloudflare Tunnel",
            level: "warn",
            detail: "Disabled. Make sure you have a working external HTTPS endpoint",
        });
    } else if (publicAccess?.kind === "cloudflare") {
        const cloudflaredBin = await suggestCloudflaredBin(publicAccess.cloudflaredBin);
        if (!cloudflaredBin) {
            checks.push({
                label: "cloudflared",
                level: "error",
                detail: "cloudflared not found. Run `codex-mcp setup` again to continue",
            });
        } else {
            try {
                const version = await probeCloudflaredVersion(cloudflaredBin);
                checks.push({ label: "cloudflared", level: "ok", detail: version });
            } catch (error) {
                checks.push({
                    label: "cloudflared",
                    level: "error",
                    detail: readableError(error),
                });
            }
        }

        const managedLoginPath = getCloudflareOriginCertPath();
        const managedLogin = hasManagedCloudflareLogin();
        checks.push({
            label: "Cloudflare login",
            level: managedLogin ? "ok" : "warn",
            detail: managedLogin
                ? `Private codex-mcp login: ${managedLoginPath}`
                : "No usable private codex-mcp login. Tunnel can still run, but changes or remote diagnostics require logging in again",
        });

        const credentialsPath = getCredentialsPath(publicAccess.tunnelId);
        const managedCredentials = canRead(credentialsPath);
        if (managedCredentials) {
            try {
                const identity = readTunnelCredentialIdentity(credentialsPath);
                const mismatch = identity.tunnelId !== publicAccess.tunnelId ||
                    identity.accountId !== publicAccess.accountId;
                checks.push({
                    label: "Tunnel credentials",
                    level: mismatch ? "error" : "ok",
                    detail: mismatch
                        ? "Credential TunnelID / AccountTag does not match the committed configuration"
                        : `${credentialsPath} · Tunnel / account match`,
                });
            } catch (error) {
                checks.push({ label: "Tunnel credentials", level: "error", detail: readableError(error) });
            }
        } else {
            checks.push({
                label: "Tunnel credentials",
                level: "error",
                detail: `Missing local credentials: ${credentialsPath}`,
            });
        }

        const runtimeConfigPath = resolveCloudflaredRuntimeConfigPath(publicAccess);
        try {
            await loadCommittedTunnelSetup(userConfig);
            checks.push({ label: "Tunnel configuration consistency", level: "ok", detail: runtimeConfigPath });
        } catch (error) {
            checks.push({ label: "Tunnel configuration consistency", level: "error", detail: readableError(error) });
        }

        if (managedLogin) {
            try {
                const login = readManagedCloudflareOriginToken();
                if (login.accountID !== publicAccess.accountId) {
                    checks.push({
                        label: "Cloudflare account consistency",
                        level: "error",
                        detail: "Private login account differs from the committed Tunnel account; run setup to choose an account again",
                    });
                } else {
                    checks.push({ label: "Cloudflare account consistency", level: "ok", detail: publicAccess.accountId });
                }
            } catch (error) {
                checks.push({ label: "Cloudflare account consistency", level: "error", detail: readableError(error) });
            }
            try {
                const [tunnel, dns] = await Promise.all([
                    inspectCloudflareTunnel(publicAccess.accountId, publicAccess.tunnelId),
                    snapshotCloudflareDns(publicAccess.zoneId, publicAccess.domain),
                ]);
                checks.push({
                    label: "Remote Cloudflare Tunnel status",
                    level: tunnel.exists ? (tunnel.status === "down" ? "warn" : "ok") : "error",
                    detail: tunnel.exists
                        ? `${tunnel.status ?? "Unknown status"} · ${tunnel.connectorCount ?? 0} items connector`
                        : "Remote Tunnel does not exist",
                });
                const dnsMatches = dnsSnapshotPointsToTunnel(dns, publicAccess.tunnelId);
                checks.push({
                    label: "Cloudflare DNS consistency",
                    level: dnsMatches ? "ok" : "error",
                    detail: dnsMatches
                        ? `${publicAccess.domain} → ${publicAccess.tunnelId}.cfargotunnel.com`
                        : `${publicAccess.domain} does not point exclusively to the committed Tunnel`,
                });
            } catch (error) {
                checks.push({
                    label: "Remote Cloudflare diagnostics",
                    level: "warn",
                    detail: `Read-only API check failed: ${readableError(error)}`,
                });
            }
        } else {
            checks.push({
                label: "Remote Cloudflare diagnostics",
                level: "warn",
                detail: "No usable private codex-mcp login; run setup and log in again to enable remote consistency checks",
            });
        }
    }

    const daemon = await contactRunningDaemon();
    if (daemon) {
        const status = await daemon.client.status();
        checks.push({
            label: "Daemon",
            level: "ok",
            detail: `pid ${status.pid} · ${status.mode === "local" ? "Local" : "Public"} · ${status.version}`,
        });
        if (publicAccess && status.mode === "public") {
            const expected = `https://${publicAccess.domain}/mcp`;
            if (status.publicMcpUrl !== expected) {
                checks.push({
                    label: "Daemon configuration consistency",
                    level: "error",
                    detail: `daemon uses ${status.publicMcpUrl ?? "no public address"}, but the committed configuration is ${expected}; restart it`,
                });
            } else {
                checks.push({ label: "Daemon configuration consistency", level: "ok", detail: expected });
            }
            try {
                await verifyRunningPublicRoute(
                    publicAccess.domain,
                    userConfig?.host ?? "127.0.0.1",
                    userConfig?.port ?? 3920,
                );
                checks.push({ label: "Public instance consistency", level: "ok", detail: "Public and local endpoints return the same instance" });
            } catch (error) {
                checks.push({ label: "Public instance consistency", level: "error", detail: readableError(error) });
            }
        } else if (publicAccess) {
            checks.push({
                label: "Daemon configuration consistency",
                level: "warn",
                detail: "daemon is running in local mode; committed public configuration will be used at the next public startup",
            });
        }
        if (
            publicAccess?.kind === "cloudflare" &&
            status.runtimeIntent.local === false &&
            status.runtimeIntent.noTunnel === false
        ) {
            checks.push({
                label: "Tunnel runtime status",
                level: status.tunnel.state === "connected" ? "ok" : "error",
                detail: `${status.tunnel.state}${status.tunnel.detail ? ` · ${status.tunnel.detail}` : ""}`,
            });
        } else if (
            publicAccess?.kind === "cloudflare" &&
            status.runtimeIntent.local === false &&
            status.runtimeIntent.noTunnel === true
        ) {
            checks.push({
                label: "Tunnel runtime status",
                level: "warn",
                detail: "daemon uses --no-tunnel; managed sidecar is not started",
            });
        }
    } else {
        checks.push({ label: "Daemon", level: "warn", detail: "Stopped; project registrations and public configuration are preserved" });
    }

    const errors = checks.filter((item) => item.level === "error").length;
    const warnings = checks.filter((item) => item.level === "warn").length;
    return { checks, errors, warnings };
}

async function checkRipgrep(): Promise<DoctorCheck> {
    const binary = await findRipgrep();
    if (!binary) {
        return {
            label: "File search",
            level: "error",
            detail: "File search tool missing; run `codex-mcp doctor --fix` to restore it automatically",
        };
    }
    try {
        const result = await runSubprocess(binary, ["--version"], {
            timeoutMs: 30_000,
            maxStdoutBytes: 16 * 1024,
            maxStderrBytes: 16 * 1024,
            maxTotalBytes: 32 * 1024,
        });
        const firstLine = `${result.stdout}\n${result.stderr}`
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(Boolean);
        return {
            label: "File search",
            level: result.exitCode === 0 ? "ok" : "error",
            detail:
                result.exitCode === 0
                    ? firstLine ?? "Installed"
                    : "File search tool exists but cannot start correctly",
        };
    } catch {
        return {
            label: "File search",
            level: "error",
            detail: "File search tool exists but cannot start correctly",
        };
    }
}

async function checkCommand(
    label: string,
    command: string,
    args: string[],
    required: boolean,
): Promise<DoctorCheck> {
    try {
        const result = await runSubprocess(command, args, {
            timeoutMs: 30_000,
            maxStdoutBytes: 16 * 1024,
            maxStderrBytes: 16 * 1024,
            maxTotalBytes: 32 * 1024,
        });
        if (result.exitCode !== 0) {
            return {
                label,
                level: required ? "error" : "warn",
                detail: `${command} starts but returned an error`,
            };
        }
        const firstLine = `${result.stdout}\n${result.stderr}`
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(Boolean);
        return {
            label,
            level: "ok",
            detail: firstLine ?? "Installed",
        };
    } catch {
        return {
            label,
            level: required ? "error" : "warn",
            detail:
                label === "Codex"
                    ? "Not found; core features remain available, but Codex MCP configuration will not be inherited automatically"
                    : label === "Git"
                      ? "Not found; Git status, history, and diff features are unavailable"
                      : "Not found",
        };
    }
}

function canRead(path: string): boolean {
    try {
        accessSync(path, constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

function readableError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
