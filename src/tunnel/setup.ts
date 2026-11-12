import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { loopbackHost } from "../lib/http/listen-address.js";
import { homedir, hostname as osHostname } from "node:os";
import { printInfo, printSuccess, printWarning } from "../lib/util/terminal.js";
import { ensureManagedTool } from "../managed-tools/install.js";
import {
    ensureStarterUserConfig,
    ensureUserConfigDirs,
    getUserConfigPath,
    loadUserConfig,
    normalizeHostname,
    type CloudflarePublicAccessConfig,
    type PublicAccessConfig,
    type UserConfig,
} from "../config/user-config.js";
import { probeCloudflaredVersion, suggestCloudflaredBin } from "./bin.js";
import {
    discoverCloudflareZones,
} from "./cloudflare-account.js";
import {
    assertCredentialMatches,
    cleanupCreatedTunnel,
    ensureLogin,
    ensureTunnelCreated,
} from "./cloudflare-session.js";
import { askLine, askSelect, askYesNo, canPromptInteractively, withSpinner } from "./prompt.js";
import type { SetupPublicVerificationResult } from "./setup-verify.js";
import {
    getCredentialsPath,
    readCloudflaredYml,
    resolveCloudflaredRuntimeConfigPath,
    writeCloudflaredRevision,
} from "./yml.js";

export interface TunnelSetupResult {
    userConfig: UserConfig;
    publicAccess: PublicAccessConfig;
    domain: string;
    useCloudflared: boolean;
    bin?: string;
    tunnelId?: string;
    configPath?: string;
    configRevision?: string;
    previousConfigRevision?: string;
    zoneId?: string;
    /** Previous managed route, retained only long enough to retire its exact DNS hostname after commit. */
    previousManagedAccess?: CloudflarePublicAccessConfig;
    /** Present only for artifacts prepared by the current uncommitted wizard session. */
    candidateSession?: { createdTunnel: boolean };
}

export interface AppliedTunnelSetup {
    result: TunnelSetupResult;
    verification: SetupPublicVerificationResult;
}

export interface TunnelSetupOptions {
    /** Force the interactive question flow even when public access exists. */
    force?: boolean;
    /** Authenticate to Cloudflare again without deleting the old cert first. */
    forceCloudflareLogin?: boolean;
    host?: string;
    port?: number;
}

export interface CloudflareSetupDiscoveryResult {
    zones: string[];
    complete: boolean;
    currentDomain?: string;
    preferredZone?: string;
    defaultPrefix: string;
    tunnelName: string;
}

export interface ProgrammaticTunnelSetupOptions {
    host?: string;
    port?: number;
}

/** Resolve committed public state. This path is read-only and safe for runtime startup. */
export async function ensureTunnelSetup(
    options: TunnelSetupOptions = {},
): Promise<TunnelSetupResult> {
    const userConfig = loadUserConfig();
    const host = options.host ?? userConfig.host ?? "127.0.0.1";
    const port = options.port ?? userConfig.port ?? 3920;
    if (!options.force && userConfig.publicAccess) {
        return await loadCommittedTunnelSetup(userConfig, host, port);
    }
    if (!canPromptInteractively()) {
        throw new Error("Public address is not set. Run `codex-mcp setup` in a terminal first");
    }
    ensureUserConfigDirs();
    const starter = ensureStarterUserConfig(host, port);
    return await runConfigWizard(starter, host, port, options.forceCloudflareLogin === true);
}

export async function runTunnelWizard(
    options: { forceCloudflareLogin?: boolean; host?: string; port?: number } = {},
): Promise<TunnelSetupResult> {
    return await ensureTunnelSetup({
        force: true,
        forceCloudflareLogin: options.forceCloudflareLogin,
        host: options.host,
        port: options.port,
    });
}

export function isPublicSetupConfigured(userConfig: UserConfig): boolean {
    return userConfig.publicAccess !== undefined;
}

/** Build an external-HTTPS candidate without terminal prompts. */
export function prepareExternalTunnelSetup(
    domainValue: string,
    options: ProgrammaticTunnelSetupOptions = {},
): TunnelSetupResult {
    const userConfig = loadUserConfig();
    const host = options.host ?? userConfig.host ?? "127.0.0.1";
    const port = options.port ?? userConfig.port ?? 3920;
    const domain = normalizeHostname(domainValue);
    const publicAccess: PublicAccessConfig = { kind: "external", domain };
    const previousManagedAccess = userConfig.publicAccess?.kind === "cloudflare"
        ? userConfig.publicAccess
        : undefined;
    return {
        userConfig: { ...userConfig, host, port, publicAccess },
        publicAccess,
        domain,
        useCloudflared: false,
        ...(previousManagedAccess ? { previousManagedAccess } : {}),
        ...(previousManagedAccess?.configRevision
            ? { previousConfigRevision: previousManagedAccess.configRevision }
            : {}),
    };
}

/** Login when needed and return the selectable Cloudflare zones without exposing credentials. */
export async function discoverCloudflareSetup(
    options: ProgrammaticTunnelSetupOptions & {
        forceLogin?: boolean;
        signal?: AbortSignal;
        onLoginOutput?: (text: string) => void;
    } = {},
): Promise<CloudflareSetupDiscoveryResult> {
    const userConfig = loadUserConfig();
    const previousManaged = userConfig.publicAccess?.kind === "cloudflare" ? userConfig.publicAccess : undefined;
    const bin = await resolveOrInstallCloudflaredBin(previousManaged?.cloudflaredBin);
    await ensureLogin(bin, options.forceLogin === true, {
        signal: options.signal,
        onOutput: options.onLoginOutput,
    });
    const discovery = await discoverCloudflareZones();
    if (discovery.zones.length === 0) {
        throw new Error(
            "No domain suitable for a public hostname is available in this Cloudflare account. Named Tunnel <UUID>.cfargotunnel.com addresses can only be CNAME targets.",
        );
    }
    const currentDomain = userConfig.publicAccess?.domain;
    const preferredZone = findMatchingZone(currentDomain, discovery.zones) ?? discovery.zones[0];
    const previousPrefix = preferredZone ? subdomainPrefixForZone(currentDomain, preferredZone) : undefined;
    return {
        zones: discovery.zones,
        complete: discovery.complete,
        ...(currentDomain ? { currentDomain } : {}),
        ...(preferredZone ? { preferredZone } : {}),
        defaultPrefix: previousPrefix && !previousPrefix.includes(".") ? previousPrefix : "codex-mcp",
        tunnelName: previousManaged?.tunnelName ?? defaultTunnelName(),
    };
}

/** Build a managed Cloudflare candidate from explicit Web/CLI selections, without terminal prompts. */
export async function prepareCloudflareTunnelSetup(
    input: ProgrammaticTunnelSetupOptions & {
        zone: string;
        prefix: string;
        forceLogin?: boolean;
    },
): Promise<TunnelSetupResult> {
    const userConfig = loadUserConfig();
    const host = input.host ?? userConfig.host ?? "127.0.0.1";
    const port = input.port ?? userConfig.port ?? 3920;
    ensureUserConfigDirs();
    ensureStarterUserConfig(host, port);
    const previousManaged = userConfig.publicAccess?.kind === "cloudflare" ? userConfig.publicAccess : undefined;
    const bin = await resolveOrInstallCloudflaredBin(previousManaged?.cloudflaredBin);
    const login = await ensureLogin(bin, input.forceLogin === true);
    const discovery = await discoverCloudflareZones();
    const zone = normalizeHostname(input.zone);
    if (!discovery.zones.includes(zone)) {
        throw new Error(`No available domain in Cloudflare account: ${zone}`);
    }
    const zoneId = discovery.zoneIds[zone];
    if (!zoneId) throw new Error(`Cannot determine Cloudflare zone ID: ${zone}`);
    const domain = cloudflareManagedHostname(zone, input.prefix);
    const preferredTunnelName = previousManaged?.tunnelName ?? defaultTunnelName();
    const tunnel = await ensureTunnelCreated(
        bin,
        preferredTunnelName,
        login.accountID,
        previousManaged?.tunnelId,
    );
    try {
        const credentialsFile = getCredentialsPath(tunnel.id);
        if (!existsSync(credentialsFile)) throw new Error(`Tunnel credentials not found: ${credentialsFile}`);
        assertCredentialMatches(credentialsFile, tunnel.id, login.accountID);
        const generated = writeCloudflaredRevision({
            tunnelId: tunnel.id,
            credentialsFile,
            hostname: domain,
            serviceUrl: localServiceUrl(host, port),
        });
        const publicAccess: CloudflarePublicAccessConfig = {
            kind: "cloudflare",
            domain,
            cloudflaredBin: bin,
            tunnelName: tunnel.name,
            tunnelId: tunnel.id,
            configRevision: generated.revision,
            accountId: login.accountID,
            zoneId,
        };
        return {
            userConfig: { ...userConfig, host, port, publicAccess },
            publicAccess,
            domain,
            useCloudflared: true,
            bin,
            tunnelId: tunnel.id,
            configPath: generated.path,
            configRevision: generated.revision,
            ...(previousManaged ? { previousManagedAccess: previousManaged } : {}),
            ...(previousManaged?.configRevision ? { previousConfigRevision: previousManaged.configRevision } : {}),
            zoneId,
            candidateSession: { createdTunnel: tunnel.created },
        };
    } catch (error) {
        if (!tunnel.created) throw error;
        const cleanupErrors: string[] = [];
        await cleanupCreatedTunnel(bin, tunnel.id, cleanupErrors);
        if (cleanupErrors.length > 0) throw new Error(`${readableError(error)}; ${cleanupErrors.join("; ")}`);
        throw error;
    }
}

export async function loadCommittedTunnelSetup(
    userConfig: UserConfig = loadUserConfig(),
    host: string = userConfig.host ?? "127.0.0.1",
    port: number = userConfig.port ?? 3920,
): Promise<TunnelSetupResult> {
    const access = userConfig.publicAccess;
    if (!access) {
        throw new Error("Public address is not set. Run `codex-mcp setup` first");
    }
    if (access.kind === "external") {
        return {
            userConfig,
            publicAccess: access,
            domain: access.domain,
            useCloudflared: false,
        };
    }

    const bin = await suggestCloudflaredBin(access.cloudflaredBin);
    if (!bin) {
        throw new Error("Cloudflare Tunnel is configured, but cloudflared is missing; run `codex-mcp doctor`");
    }
    const credentialsFile = getCredentialsPath(access.tunnelId);
    if (!existsSync(credentialsFile)) {
        throw new Error(`Missing Tunnel credentials: ${credentialsFile}. Run \`codex-mcp setup\` to set up again`);
    }
    assertCredentialMatches(credentialsFile, access.tunnelId, access.accountId);
    const configPath = resolveCloudflaredRuntimeConfigPath(access);
    const parsed = readCloudflaredYml(configPath);
    const expectedService = localServiceUrl(host, port);
    if (
        parsed.tunnelId !== access.tunnelId ||
        parsed.hostname !== access.domain ||
        parsed.credentialsFile !== credentialsFile ||
        parsed.serviceUrl !== expectedService
    ) {
        throw new Error(
            `Committed public configuration does not match the Tunnel runtime file: ${configPath}.` +
            "Runtime will not rewrite it automatically. Run `codex-mcp doctor`, then repair through setup.",
        );
    }
    return {
        userConfig,
        publicAccess: access,
        domain: access.domain,
        useCloudflared: true,
        bin,
        tunnelId: access.tunnelId,
        configPath,
        configRevision: access.configRevision,
        zoneId: access.zoneId,
    };
}

async function runConfigWizard(
    userConfig: UserConfig,
    host: string,
    port: number,
    forceCloudflareLogin: boolean,
): Promise<TunnelSetupResult> {
    printInfo("Set up public access");
    printInfo(`Configuration will only be committed after successful verification: ${getUserConfigPath()}`);

    const useCloudflared = await askYesNo(
        "Allow codex-mcp to configure Cloudflare Tunnel automatically?",
        userConfig.publicAccess?.kind !== "external",
    );
    if (!useCloudflared) {
        const domain = await askPublicDomain(
            userConfig.publicAccess?.domain,
        );
        const publicAccess: PublicAccessConfig = { kind: "external", domain };
        const previousManagedAccess = userConfig.publicAccess?.kind === "cloudflare"
            ? userConfig.publicAccess
            : undefined;
        return {
            userConfig: { ...userConfig, host, port, publicAccess },
            publicAccess,
            domain,
            useCloudflared: false,
            ...(previousManagedAccess ? { previousManagedAccess } : {}),
            ...(previousManagedAccess?.configRevision
                ? { previousConfigRevision: previousManagedAccess.configRevision }
                : {}),
        };
    }

    const previousManaged = userConfig.publicAccess?.kind === "cloudflare"
        ? userConfig.publicAccess
        : undefined;
    const bin = await withSpinner(
        "Preparing Cloudflare connection tools…",
        "Cloudflare connection tools ready",
        () => resolveOrInstallCloudflaredBin(previousManaged?.cloudflaredBin),
    );
    const login = await ensureLogin(bin, forceCloudflareLogin);

    const discovery = await withSpinner(
        "Reading domains from Cloudflare account…",
        "Cloudflare domains loaded",
        () => discoverCloudflareZones(),
    );
    if (discovery.zones.length === 0) {
        throw new Error(
            "No domain suitable for a public hostname is available in this Cloudflare account." +
            "Named Tunnel <UUID>.cfargotunnel.com addresses can only be CNAME targets, not ChatGPT connection addresses.",
        );
    }
    printSuccess(`Detected ${discovery.zones.length} available Cloudflare domains.`);
    if (!discovery.complete) {
        printWarning("Cloudflare did not allow listing all domains. Only the domain selected during login will be used.");
    }

    const previousDomain = userConfig.publicAccess?.domain;
    const preferredZone = findMatchingZone(previousDomain, discovery.zones) ?? discovery.zones[0];
    const zone = discovery.zones.length === 1
        ? discovery.zones[0]!
        : await askSelect(
              "Choose a Cloudflare domain for codex-mcp",
              discovery.zones.map((value) => ({ value, label: value })),
              preferredZone,
          );
    if (discovery.zones.length === 1) printSuccess(`Using Cloudflare domain: ${zone}`);
    const zoneId = discovery.zoneIds[zone];
    if (!zoneId) throw new Error(`Cannot determine Cloudflare zone ID: ${zone}`);

    const previousPrefix = subdomainPrefixForZone(previousDomain, zone);
    const prefixDefault = previousPrefix && !previousPrefix.includes(".") ? previousPrefix : "codex-mcp";
    const domain = await askCloudflareHostname(zone, prefixDefault);

    const preferredTunnelName = previousManaged?.tunnelName ?? defaultTunnelName();
    const tunnel = await ensureTunnelCreated(
        bin,
        preferredTunnelName,
        login.accountID,
        previousManaged?.tunnelId,
    );
    try {
        const credentialsFile = getCredentialsPath(tunnel.id);
        if (!existsSync(credentialsFile)) {
            throw new Error(`Tunnel credentials not found: ${credentialsFile}`);
        }
        assertCredentialMatches(credentialsFile, tunnel.id, login.accountID);
        const generated = writeCloudflaredRevision({
            tunnelId: tunnel.id,
            credentialsFile,
            hostname: domain,
            serviceUrl: localServiceUrl(host, port),
        });
        printSuccess(`Candidate Tunnel configuration ready: ${generated.path}`);

        const publicAccess: CloudflarePublicAccessConfig = {
            kind: "cloudflare",
            domain,
            cloudflaredBin: bin,
            tunnelName: tunnel.name,
            tunnelId: tunnel.id,
            configRevision: generated.revision,
            accountId: login.accountID,
            zoneId,
        };
        return {
            userConfig: { ...userConfig, host, port, publicAccess },
            publicAccess,
            domain,
            useCloudflared: true,
            bin,
            tunnelId: tunnel.id,
            configPath: generated.path,
            configRevision: generated.revision,
            ...(previousManaged ? { previousManagedAccess: previousManaged } : {}),
            ...(previousManaged?.configRevision
                ? { previousConfigRevision: previousManaged.configRevision }
                : {}),
            zoneId,
            candidateSession: { createdTunnel: tunnel.created },
        };
    } catch (error) {
        if (!tunnel.created) throw error;
        const cleanupErrors: string[] = [];
        await cleanupCreatedTunnel(bin, tunnel.id, cleanupErrors);
        if (cleanupErrors.length > 0) {
            throw new Error(`${readableError(error)}; ${cleanupErrors.join("; ")}`);
        }
        throw error;
    }
}

export async function resolveOrInstallCloudflaredBin(configured?: string): Promise<string> {
    const existing = await suggestCloudflaredBin(configured);
    if (existing) {
        await probeCloudflaredVersion(existing);
        return existing;
    }
    try {
        const installed = await ensureManagedTool("cloudflared");
        await probeCloudflaredVersion(installed.path);
        return installed.path;
    } catch (error) {
        throw new Error(`Failed to prepare public connection tools: ${readableError(error)}`);
    }
}

function localServiceUrl(host: string, port: number): string {
    return `http://${loopbackHost(host)}:${port}`;
}

async function askPublicDomain(
    defaultValue?: string,
    allowedZones?: string[],
): Promise<string> {
    while (true) {
        const domainRaw = (await askLine(
            "Domain for ChatGPT (for example, mcp.example.com)",
            defaultValue,
        )).trim();
        if (!domainRaw) {
            printWarning("Enter a domain. Without one, use `codex-mcp start --local` for local access only.");
            continue;
        }
        let domain: string;
        try {
            domain = normalizeHostname(domainRaw);
        } catch (error) {
            printWarning(readableError(error));
            continue;
        }
        if (allowedZones && !hostnameBelongsToZones(domain, allowedZones)) {
            printWarning(`This domain is not among the domains detected in the current Cloudflare account: ${allowedZones.join(", ")}`);
            continue;
        }
        return domain;
    }
}

export function hostnameBelongsToZones(hostname: string, zones: string[]): boolean {
    const normalized = normalizeHostname(hostname);
    return zones.some((zone) => normalized === zone || normalized.endsWith(`.${zone}`));
}

export function findMatchingZone(
    hostname: string | undefined,
    zones: string[],
): string | undefined {
    if (!hostname) return undefined;
    const normalized = normalizeHostname(hostname);
    return [...zones]
        .sort((left, right) => right.length - left.length)
        .find((zone) => normalized === zone || normalized.endsWith(`.${zone}`));
}

export function subdomainPrefixForZone(
    hostname: string | undefined,
    zone: string,
): string | undefined {
    if (!hostname) return undefined;
    const normalized = normalizeHostname(hostname);
    if (normalized === zone) return undefined;
    const suffix = `.${zone}`;
    if (!normalized.endsWith(suffix)) return undefined;
    return normalized.slice(0, -suffix.length) || undefined;
}

export function defaultTunnelName(
    machineHostname: string = osHostname(),
    homeDirectory: string = homedir(),
): string {
    const slug = machineHostname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 28) || "host";
    const resolvedHome = resolve(homeDirectory);
    let canonicalHome = resolvedHome;
    try {
        canonicalHome = realpathSync.native(resolvedHome);
    } catch {
        // A caller may ask for a deterministic name before the home exists.
        // Syntactic normalization is still better than hashing a raw spelling.
    }
    const suffix = createHash("sha256")
        .update(`${machineHostname}\0${canonicalHome}`, "utf8")
        .digest("hex")
        .slice(0, 6);
    return `codex-mcp-${slug}-${suffix}`;
}

export function cloudflareManagedHostname(zone: string, prefix: string): string {
    const normalizedPrefix = prefix.trim();
    if (!normalizedPrefix) {
        throw new Error("Enter a subdomain prefix, for example codex-mcp.");
    }
    if (normalizedPrefix.includes(".")) {
        throw new Error(
            "Cloudflare default Universal SSL only covers first-level subdomains of the selected domain." +
            "Use a prefix without dots. Multi-level subdomains require a matching Edge Certificate first.",
        );
    }
    const hostname = normalizeHostname(`${normalizedPrefix}.${zone}`);
    if (findMatchingZone(hostname, [zone]) !== zone) {
        throw new Error("Subdomain does not belong to the selected Cloudflare domain");
    }
    return hostname;
}

async function askCloudflareHostname(zone: string, defaultPrefix: string): Promise<string> {
    while (true) {
        const prefix = (await askLine("Subdomain prefix", defaultPrefix)).trim();
        try {
            return cloudflareManagedHostname(zone, prefix);
        } catch (error) {
            printWarning(readableError(error));
        }
    }
}

function readableError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
