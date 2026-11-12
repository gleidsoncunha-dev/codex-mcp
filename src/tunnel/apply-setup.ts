import { printSuccess, printWarning } from "../lib/util/terminal.js";
import { withSpinner } from "./prompt.js";
import { getUserConfigPath, saveUserConfig } from "../config/user-config.js";
import { cutoverCloudflareDns, dnsSnapshotReferencesTunnel, dnsSnapshotPointsToTunnel, removeCloudflareManagedDnsIfOwned, restoreCloudflareDns, snapshotCloudflareDns, type CloudflareDnsSnapshot } from "./cloudflare-api.js";
import { requireDnsOverwriteConfirmation } from "./confirm.js";
import { assertSetupPortAvailable, verifySetupPublicRoute } from "./setup-verify.js";
import { removeCloudflaredRevision } from "./yml.js";
import { cleanupCreatedTunnel } from "./cloudflare-session.js";
import type { AppliedTunnelSetup, TunnelSetupResult } from "./setup.js";

// Only external effects are replaceable. The transition order, commit decision,
// reference checks and compensation policy stay in this module.
const setupOperations = {
    assertSetupPortAvailable, verifySetupPublicRoute, snapshotCloudflareDns,
    cutoverCloudflareDns, restoreCloudflareDns, removeCloudflareManagedDnsIfOwned, saveUserConfig,
    removeCloudflaredRevision, cleanupFailedCandidate, requireDnsOverwriteConfirmation,
};
type SetupOperations = typeof setupOperations;

export interface ApplyTunnelSetupOptions {
    signal?: AbortSignal;
    onPhase?: (phase: string) => void;
    confirmDnsOverwrite?: (domain: string) => Promise<void>;
}

/** Verify a candidate, compensate remote changes on failure, then commit locally. */
export async function applyTunnelSetup(
    candidate: TunnelSetupResult,
    overrides: Partial<SetupOperations> = {},
    options: ApplyTunnelSetupOptions = {},
): Promise<AppliedTunnelSetup> {
    const operations = { ...setupOperations, ...overrides };
    const host = candidate.userConfig.host ?? "127.0.0.1";
    const port = candidate.userConfig.port ?? 3920;
    const cancellation = installSetupCancellationGuard(options.signal);

    let dnsSnapshot: CloudflareDnsSnapshot | undefined;
    let committedDns: CloudflareDnsSnapshot | undefined;
    let dnsChanged = false;
    let phase = "Local port preflight";
    const setPhase = (next: string): void => {
        phase = next;
        options.onPhase?.(next);
    };
    options.onPhase?.(phase);
    try {
        await operations.assertSetupPortAvailable(host, port);
        cancellation.throwIfRequested();
        setPhase(candidate.useCloudflared ? "Start candidate connector" : "Public access verification");
        const verification = await operations.verifySetupPublicRoute(candidate, host, port, {
            signal: cancellation.signal,
            beforePublicVerify: candidate.useCloudflared
                ? async () => {
                      cancellation.throwIfRequested();
                      setPhase("DNS snapshot");
                      if (!candidate.zoneId || !candidate.tunnelId) {
                          throw new Error("Cloudflare DNS configuration is missing zone or Tunnel ID");
                      }
                      dnsSnapshot = await operations.snapshotCloudflareDns(candidate.zoneId, candidate.domain);
                      if (
                          dnsSnapshot.records.length > 0 &&
                          !dnsSnapshotPointsToTunnel(dnsSnapshot, candidate.tunnelId)
                      ) {
                          printWarning(`Domain ${candidate.domain} already has another DNS record. Confirm whether to replace it.`);
                          if (options.confirmDnsOverwrite) {
                              await options.confirmDnsOverwrite(candidate.domain);
                          } else {
                              await operations.requireDnsOverwriteConfirmation(candidate.domain);
                          }
                      }
                      cancellation.throwIfRequested();
                      setPhase("DNS cutover");
                      const cutover = await withSpinner(
                          `Connecting domain ${candidate.domain} to the ready Tunnel…`,
                          "DNS route switched",
                          () => operations.cutoverCloudflareDns(dnsSnapshot!, candidate.tunnelId!),
                      );
                      dnsChanged = cutover.changed;
                      committedDns = cutover.committed;
                      cancellation.throwIfRequested();
                      setPhase("Public access verification");
                  }
                : undefined,
        });

        cancellation.throwIfRequested();
        setPhase("Commit local configuration");
        const committedConfig = operations.saveUserConfig({
            host,
            port,
            publicAccess: candidate.publicAccess,
        });
        if (
            candidate.previousConfigRevision &&
            candidate.previousConfigRevision !== candidate.configRevision
        ) {
            try {
                operations.removeCloudflaredRevision(candidate.previousConfigRevision);
            } catch (error) {
                printWarning(`Failed to clean up the previous Tunnel configuration revision; check it manually later: ${readableError(error)}`);
            }
        }
        const previousManaged = candidate.previousManagedAccess;
        if (previousManaged && previousManaged.domain !== candidate.domain) {
            try {
                setPhase("Clean up previous public DNS");
                const removed = await operations.removeCloudflareManagedDnsIfOwned(
                    previousManaged.zoneId,
                    previousManaged.domain,
                    previousManaged.tunnelId,
                );
                if (removed) printSuccess(`Removed previous public address: ${previousManaged.domain}`);
            } catch (error) {
                printWarning(`New public access configuration committed, but old DNS cleanup failed: ${readableError(error)}`);
            }
        }
        printSuccess(`codex-mcp configuration committed atomically: ${getUserConfigPath()}`);
        return {
            result: { ...candidate, userConfig: committedConfig },
            verification,
        };
    } catch (error) {
        const recoveryErrors: string[] = [];
        let mayDeleteCreatedTunnel = !dnsSnapshot ||
            !candidate.tunnelId ||
            !dnsSnapshotPointsToTunnel(dnsSnapshot, candidate.tunnelId);
        if (dnsSnapshot && committedDns && dnsChanged) {
            mayDeleteCreatedTunnel = false;
            try {
                await operations.restoreCloudflareDns(dnsSnapshot, committedDns);
                mayDeleteCreatedTunnel = true;
                printWarning("Public verification failed. Previous DNS records restored.");
            } catch (restoreError) {
                recoveryErrors.push(`DNS restoration failed: ${readableError(restoreError)}`);
            }
        }
        if (
            dnsSnapshot &&
            candidate.candidateSession?.createdTunnel &&
            candidate.zoneId &&
            candidate.tunnelId
        ) {
            try {
                const latestDns = await operations.snapshotCloudflareDns(candidate.zoneId, candidate.domain);
                if (dnsSnapshotReferencesTunnel(latestDns, candidate.tunnelId)) {
                    mayDeleteCreatedTunnel = false;
                }
            } catch (inspectError) {
                mayDeleteCreatedTunnel = false;
                recoveryErrors.push(`Candidate DNS reference check failed: ${readableError(inspectError)}`);
            }
        }
        await operations.cleanupFailedCandidate(candidate, recoveryErrors, mayDeleteCreatedTunnel);
        if (recoveryErrors.length > 0) {
            throw new Error(
                `Public access setup failed (phase: ${phase}): ${readableError(error)}; ${recoveryErrors.join("; ")}.` +
                "Cloudflare may be partially modified. Run `codex-mcp doctor` before overwriting DNS again.",
            );
        }
        throw new Error(`Public access setup failed (phase: ${phase}): ${readableError(error)}`, {
            cause: error,
        });
    } finally {
        cancellation.dispose();
    }
}

export async function discardTunnelSetupCandidate(candidate: TunnelSetupResult): Promise<void> {
    const recoveryErrors: string[] = [];
    await cleanupFailedCandidate(candidate, recoveryErrors, true);
    if (recoveryErrors.length > 0) {
        throw new Error(recoveryErrors.join("; "));
    }
}

async function cleanupFailedCandidate(
    candidate: TunnelSetupResult,
    recoveryErrors: string[],
    mayDeleteCreatedTunnel: boolean,
): Promise<void> {
    if (candidate.candidateSession && candidate.configRevision) {
        try {
            removeCloudflaredRevision(candidate.configRevision);
        } catch (error) {
            recoveryErrors.push(`Candidate YAML cleanup failed: ${readableError(error)}`);
        }
    }
    if (!candidate.candidateSession?.createdTunnel || !candidate.bin || !candidate.tunnelId) return;
    if (!mayDeleteCreatedTunnel) {
        recoveryErrors.push(
            "The candidate Tunnel may still be referenced by DNS; automatic deletion was skipped to avoid worsening the failure",
        );
        return;
    }
    await cleanupCreatedTunnel(candidate.bin, candidate.tunnelId, recoveryErrors);
}

function installSetupCancellationGuard(externalSignal?: AbortSignal): {
    signal: AbortSignal;
    throwIfRequested: () => void;
    dispose: () => void;
} {
    const controller = new AbortController();
    let announced = false;
    const abort = (reason: unknown): void => {
        if (!controller.signal.aborted) {
            controller.abort(reason instanceof Error ? reason : new Error("Public access setup cancelled"));
        }
    };
    const onExternalAbort = (): void => abort(externalSignal?.reason);
    const onSigint = (): void => {
        abort(new Error("Public access setup cancelled"));
        if (!announced) {
            announced = true;
            printWarning("Interrupt received. Safely ending public access setup and attempting to restore any changed DNS first.");
        }
    };
    if (externalSignal?.aborted) onExternalAbort();
    else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigint);
    return {
        signal: controller.signal,
        throwIfRequested: () => {
            if (controller.signal.aborted) {
                throw controller.signal.reason instanceof Error
                    ? controller.signal.reason
                    : new Error("Public access setup cancelled");
            }
        },
        dispose: () => {
            externalSignal?.removeEventListener("abort", onExternalAbort);
            process.off("SIGINT", onSigint);
            process.off("SIGTERM", onSigint);
        },
    };
}

function readableError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
