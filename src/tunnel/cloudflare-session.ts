import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { copyPrivateFileAtomic } from "../lib/fs/atomic-file.js";
import { printInfo, printSuccess, printWarning } from "../lib/util/terminal.js";
import {
    getCloudflareOriginCertPath,
    hasManagedCloudflareLogin,
    parseCloudflareOriginToken,
    readManagedCloudflareOriginToken,
    readTunnelCredentialIdentity,
    type CloudflareOriginToken,
} from "./cloudflare-account.js";
import { runCloudflared, runCloudflaredInherit } from "./exec.js";
import { withSpinner } from "./prompt.js";
import {
    ensureCloudflaredManagementConfig,
    getCredentialsPath,
    getManagedCloudflareDir,
} from "./yml.js";

const TUNNEL_ID_RE =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export async function ensureLogin(
    bin: string,
    force: boolean,
    options: { signal?: AbortSignal; onOutput?: (text: string) => void } = {},
): Promise<CloudflareOriginToken> {
    if (!force && hasManagedCloudflareLogin()) {
        printSuccess("Already logged in to Cloudflare.");
        return readManagedCloudflareOriginToken();
    }
    if (force) {
        printInfo("Logging in again in a temporary directory. Existing login will be kept until new credentials are verified.");
    } else if (existsSync(getCloudflareOriginCertPath())) {
        printWarning("Saved Cloudflare login credentials are invalid. Logging in again safely.");
    }

    mkdirSync(getManagedCloudflareDir(), { recursive: true });
    const candidateHome = mkdtempSync(join(getManagedCloudflareDir(), ".login-"));
    const candidateCert = join(candidateHome, ".cloudflared", "cert.pem");
    try {
        printInfo("Opening the browser. Log in to Cloudflare and authorize access…");
        const code = options.signal || options.onOutput
            ? (await runCloudflared(
                  bin,
                  cloudflaredManagementArgs("login"),
                  {
                      managedHome: candidateHome,
                      allowFailure: true,
                      signal: options.signal,
                      onOutput: options.onOutput,
                  },
              )).code ?? 1
            : await runCloudflaredInherit(
                  bin,
                  cloudflaredManagementArgs("login"),
                  { managedHome: candidateHome },
              );
        if (code !== 0 || !existsSync(candidateCert)) {
            throw new Error("Cloudflare login incomplete; previous login unchanged");
        }
        const token = parseCloudflareOriginToken(readFileSync(candidateCert, "utf8"));
        copyPrivateFileAtomic(candidateCert, getCloudflareOriginCertPath());
        printSuccess("Cloudflare login credentials updated safely.");
        return token;
    } finally {
        rmSync(candidateHome, { recursive: true, force: true });
    }
}

export async function ensureTunnelCreated(
    bin: string,
    preferredName: string,
    accountId: string,
    knownId?: string,
): Promise<{ id: string; name: string; created: boolean }> {
    const tunnels = await withSpinner(
        "Checking existing Cloudflare Tunnels…",
        "Cloudflare Tunnel Checks complete",
        () => listTunnels(bin),
    );
    const exactMatches = tunnels.filter((item) => item.name === preferredName);
    if (exactMatches.length > 1) throw new Error(`Multiple Tunnels have the same name: ${preferredName}`);
    const reusable = selectReusableTunnel(
        tunnels,
        preferredName,
        (id) => hasMatchingCredential(id, accountId),
        knownId,
    );
    if (reusable) {
        if (reusable.name !== preferredName) {
            printInfo(`Found an existing local historical Tunnel: ${reusable.name}`);
        }
        printSuccess(`Reusing existing Tunnel: ${reusable.name}`);
        return { id: reusable.id, name: reusable.name, created: false };
    }

    const existing = exactMatches[0]?.id;
    let name = preferredName;
    if (existing) {
        name = `${preferredName}-${randomUUID().slice(0, 8)}`;
        printWarning(
            `A Tunnel with this name exists on Cloudflare, but its credentials are missing locally. Keeping remote resources and creating a replacement Tunnel: ${name}`,
        );
    }
    const result = await withSpinner(
        "Creating Cloudflare Tunnel…",
        "Cloudflare Tunnel creation request complete",
        () => runCloudflared(bin, cloudflaredManagementArgs("create", name), { allowFailure: true }),
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    const outputId = result.code === 0 ? combined.match(TUNNEL_ID_RE)?.[0] : undefined;
    let created = outputId;
    let reconciliationError: unknown;
    if (!created) {
        try {
            created = await findTunnelIdByName(bin, name);
        } catch (error) {
            reconciliationError = error;
        }
    }
    if (created) {
        try {
            assertCredentialMatches(getCredentialsPath(created), created, accountId);
            if (result.code !== 0 || !outputId) {
                printWarning("Tunnel creation verified against the remote list and local credentials.");
            }
            printSuccess("Tunnel created.");
            return { id: created, name, created: true };
        } catch (credentialError) {
            if (result.code !== 0) {
                throw new Error(
                    `A remote resource with the same name was found after Tunnel creation failed, but ownership by this request cannot be proved; ` +
                    `automatic cleanup skipped to avoid deleting a concurrently created Tunnel: ${readableError(credentialError)}.` +
                    "Run `codex-mcp doctor` and check the Cloudflare dashboard first",
                );
            }
            const cleanupErrors: string[] = [];
            await cleanupCreatedTunnel(bin, created, cleanupErrors);
            throw new Error(
                `Tunnel created remotely, but local credentials are unavailable: ${readableError(credentialError)}` +
                (cleanupErrors.length > 0 ? `; ${cleanupErrors.join("; ")}` : "; Remote Tunnel removed"),
            );
        }
    }
    if (reconciliationError || result.code === 0) {
        throw new Error(
            `Cannot confirm remote state after Tunnel creation request (name: ${name}): ` +
            `${reconciliationError ? readableError(reconciliationError) : "Remote list has not returned the new Tunnel yet"}.` +
            "Cloudflare may have created resources. Run `codex-mcp doctor` before retrying",
        );
    }
    throw new Error(`Failed to create Tunnel: ${(result.stderr || result.stdout).trim()}`);
}

export function assertCredentialMatches(
    path: string,
    tunnelId: string,
    accountId?: string,
): void {
    const identity = readTunnelCredentialIdentity(path);
    if (identity.tunnelId !== tunnelId.toLowerCase()) {
        throw new Error(`Tunnel credential ID does not match committed configuration: ${path}`);
    }
    if (accountId && identity.accountId !== accountId) {
        throw new Error(`Tunnel credential account does not match committed configuration: ${path}`);
    }
}

export async function cleanupCreatedTunnel(
    bin: string,
    tunnelId: string,
    recoveryErrors: string[],
): Promise<void> {
    try {
        await deleteTunnel(bin, tunnelId);
        rmSync(getCredentialsPath(tunnelId), { force: true });
        printWarning("Removed the newly created, uncommitted Tunnel.");
    } catch (error) {
        recoveryErrors.push(`Candidate Tunnel cleanup failed: ${readableError(error)}`);
    }
}

function hasMatchingCredential(tunnelId: string, accountId: string): boolean {
    const path = getCredentialsPath(tunnelId);
    if (!existsSync(path)) return false;
    try {
        assertCredentialMatches(path, tunnelId, accountId);
        return true;
    } catch {
        return false;
    }
}

async function deleteTunnel(bin: string, tunnelId: string): Promise<void> {
    const result = await runCloudflared(
        bin,
        cloudflaredManagementArgs("delete", "-f", tunnelId),
        { allowFailure: true, timeoutMs: 180_000 },
    );
    if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout).trim() || `Exit code ${result.code}`);
    }
}

interface ListedTunnel {
    id: string;
    name: string;
}

export function selectReusableTunnel(
    tunnels: ListedTunnel[],
    preferredName: string,
    ownsCredential: (id: string) => boolean,
    knownId?: string,
): ListedTunnel | undefined {
    const owned = tunnels.filter((item) => ownsCredential(item.id));
    if (knownId) {
        const known = owned.find((item) => item.id === knownId);
        if (known) return known;
    }
    const family = owned.filter(
        (item) => item.name === preferredName || item.name.startsWith(`${preferredName}-`),
    );
    const exact = family.find((item) => item.name === preferredName);
    if (exact) return exact;
    if (family.length > 0) {
        // A suffixed name is created only when the default name was already occupied.
        // Matching local credentials prove the tunnel belongs to this codex-mcp home.
        return [...family].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))[0];
    }
    // Hostnames can change (for example a Mac DHCP hostname), which changes the
    // default tunnel name. If this private codex-mcp home owns exactly one active
    // Tunnel in the account, that ownership proof is stronger than the display name.
    return owned.length === 1 ? owned[0] : undefined;
}

async function listTunnels(bin: string): Promise<ListedTunnel[]> {
    const jsonAttempt = await runCloudflared(
        bin,
        cloudflaredManagementArgs("list", "--output", "json"),
        { allowFailure: true, timeoutMs: 180_000 },
    );
    if (jsonAttempt.code !== 0) {
        throw new Error((jsonAttempt.stderr || jsonAttempt.stdout).trim() || `Cannot read Cloudflare Tunnel list (exit code ${jsonAttempt.code})`);
    }
    const rows: unknown = JSON.parse(jsonAttempt.stdout);
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.id !== "string" || typeof row.name !== "string")) {
        throw new Error("cloudflared returned an invalid Tunnel JSON list; update cloudflared");
    }
    return rows.map((row) => ({ id: row.id, name: row.name }));
}

async function findTunnelIdByName(
    bin: string,
    tunnelName: string,
): Promise<string | undefined> {
    const matches = (await listTunnels(bin)).filter((row) => row.name === tunnelName);
    if (matches.length > 1) throw new Error(`Multiple Tunnels have the same name: ${tunnelName}`);
    return matches[0]?.id;
}

function cloudflaredManagementArgs(...args: string[]): string[] {
    const command = ["tunnel", "--config", ensureCloudflaredManagementConfig()];
    if (args[0] !== "login" && hasManagedCloudflareLogin()) {
        command.push("--origincert", getCloudflareOriginCertPath());
    }
    return [...command, ...args];
}

function readableError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
