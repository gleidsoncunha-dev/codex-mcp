import { applyTunnelSetup, discardTunnelSetupCandidate } from "./apply-setup.js";
import { loadUserConfig } from "../config/user-config.js";
import {
    contactRunningDaemon,
    isProcessAlive,
    startDaemonForIntent,
    stopDaemonContact,
    withDaemonLifecycleLock,
    type DaemonContact,
} from "../daemon/control.js";
import type { RuntimeIntent } from "../daemon/state.js";
import { printInfo, printWarning } from "../lib/util/terminal.js";
import {
    ensureTunnelSetup,
    loadCommittedTunnelSetup,
    runTunnelWizard,
    type AppliedTunnelSetup,
    type TunnelSetupResult,
} from "./setup.js";
import {
    assertSetupPortAvailable,
    inspectSetupPort,
    verifyRunningPublicRoute,
    verifySetupPublicRoute,
    type SetupPublicVerificationResult,
} from "./setup-verify.js";

export interface ConfigurePublicAccessOptions {
    forceWizard: boolean;
    forceCloudflareLogin?: boolean;
}

export interface ConfigurePublicAccessResult extends AppliedTunnelSetup {
    daemonRestarted: boolean;
}

export interface ConfigurePreparedPublicAccessOptions {
    signal?: AbortSignal;
    onPhase?: (phase: string) => void;
    confirmDnsOverwrite?: (domain: string) => Promise<void>;
}

/** Single owner for interactive public configuration and daemon handoff. */
export async function configurePublicAccess(
    options: ConfigurePublicAccessOptions,
): Promise<ConfigurePublicAccessResult> {
    return await configurePreparedPublicAccess(async ({ host, port }) =>
        options.forceWizard
            ? await runTunnelWizard({
                  forceCloudflareLogin: options.forceCloudflareLogin,
                  host,
                  port,
              })
            : await ensureTunnelSetup({ host, port }),
    );
}

/** Transactional public-access orchestration shared by terminal setup and the local Web Console. */
export async function configurePreparedPublicAccess(
    prepareCandidate: (context: { host: string; port: number }) => Promise<TunnelSetupResult>,
    options: ConfigurePreparedPublicAccessOptions = {},
): Promise<ConfigurePublicAccessResult> {
    return await withDaemonLifecycleLock(async () => {
        const current = loadUserConfig();
        const host = current.host ?? "127.0.0.1";
        const port = current.port ?? 3920;
        const initialDaemon = await contactRunningDaemon();
        let previousIntent = initialDaemon?.state.runtimeIntent;

        options.signal?.throwIfAborted();
        options.onPhase?.("Local port preflight");
        // If no supported daemon owns the origin port, reject an unknown port
        // conflict before creating or changing any Cloudflare candidate resource.
        // A healthy daemon stays online while the candidate is prepared.
        if (!initialDaemon) {
            await assertSetupPortAvailable(host, port);
        }

        let candidate: TunnelSetupResult | undefined;
        let applyStarted = false;
        let stopAttempted: DaemonContact | undefined;
        let daemonStopped = false;
        let committed = false;
        try {
            options.onPhase?.("Prepare candidate public configuration");
            candidate = await prepareCandidate({ host, port });
            options.signal?.throwIfAborted();

            const daemon = await contactRunningDaemon();
            if (daemon) {
                previousIntent = daemon.state.runtimeIntent;
                stopAttempted = daemon;
                printInfo(`Candidate public configuration ready. Briefly pausing background service (pid ${daemon.state.pid})…`);
                await stopDaemonContact(daemon);
                daemonStopped = true;
            } else if (initialDaemon) {
                daemonStopped = true;
                printWarning("The previous background service exited during setup. It will restart in its original mode when setup finishes.");
            }

            applyStarted = true;
            const applied = await applyTunnelSetup(candidate, {}, {
                signal: options.signal,
                onPhase: options.onPhase,
                confirmDnsOverwrite: options.confirmDnsOverwrite,
            });
            committed = true;
            if (previousIntent) {
                try {
                    options.onPhase?.("Restore background service");
                    await restartAfterSetup(previousIntent);
                } catch (restartError) {
                    throw new Error(
                        `Public configuration committed and verified, but background service restoration failed: ${readableError(restartError)}.` +
                        "Run `codex-mcp status` and `codex-mcp doctor` to inspect, then `codex-mcp start` to restart.",
                    );
                }
            }
            return { ...applied, daemonRestarted: previousIntent !== undefined };
        } catch (error) {
            const recoveryErrors: string[] = [];
            if (candidate && !applyStarted) {
                try {
                    await discardTunnelSetupCandidate(candidate);
                } catch (discardError) {
                    recoveryErrors.push(`Candidate cleanup failed: ${readableError(discardError)}`);
                }
            }
            if (previousIntent && !committed && (daemonStopped || stopAttempted)) {
                const originalStillAlive = stopAttempted
                    ? isProcessAlive(stopAttempted.state.pid)
                    : false;
                if (originalStillAlive) {
                    printWarning("Public setup incomplete. The previous background service is still running; no restart is needed.");
                } else {
                    try {
                        await restartAfterSetup(previousIntent);
                        printWarning("Public setup incomplete. Previous background service restored.");
                    } catch (restartError) {
                        recoveryErrors.push(`Previous background service restoration failed: ${readableError(restartError)}`);
                    }
                }
            }
            if (recoveryErrors.length > 0) {
                throw new Error(`${readableError(error)}; ${recoveryErrors.join("; ")}`);
            }
            throw error;
        }
    });
}

/** Read-only public check. No login, migration, config write, or DNS mutation. */
export async function checkPublicAccess(): Promise<SetupPublicVerificationResult> {
    const config = loadUserConfig();
    const access = config.publicAccess;
    if (!access) throw new Error("Public access has not been configured");
    const host = config.host ?? "127.0.0.1";
    const port = config.port ?? 3920;
    const committed = await loadCommittedTunnelSetup(config, host, port);
    const daemon = await contactRunningDaemon();
    if (daemon) {
        return await verifyRunningPublicRoute(access.domain, host, port);
    }
    const portState = await inspectSetupPort(host, port);
    if (portState === "codex-mcp") {
        return await verifyRunningPublicRoute(access.domain, host, port);
    }
    if (portState === "occupied") {
        throw new Error(`Local port ${port} is in use by another program; cannot check public access`);
    }
    return await verifySetupPublicRoute(committed, host, port, {});
}

async function restartAfterSetup(intent: RuntimeIntent): Promise<DaemonContact> {
    printInfo("Restoring background service in its original mode…");
    return await startDaemonForIntent(intent);
}

function readableError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
