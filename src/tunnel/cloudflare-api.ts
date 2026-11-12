import { readManagedCloudflareOriginToken } from "./cloudflare-account.js";
import { safeHttpRequest } from "../lib/http/safe-http.js";
import { normalizeTunnelId } from "./id.js";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const API_TIMEOUT_MS = 30_000;
const MAX_API_BODY_CHARS = 2 * 1024 * 1024;
const DNS_TYPES_WITH_DATA = new Set([
    "CAA", "CERT", "DNSKEY", "DS", "HTTPS", "LOC", "NAPTR",
    "SMIMEA", "SRV", "SSHFP", "SVCB", "TLSA", "URI",
]);

interface CloudflareApiEnvelope<T> {
    success?: boolean;
    result?: T;
    errors?: Array<{ message?: string }>;
}

export interface CloudflareDnsRecordSnapshot {
    id: string;
    type: string;
    name: string;
    ttl: number;
    content?: string;
    proxied?: boolean;
    private_routing?: boolean;
    priority?: number | null;
    data?: unknown;
    /** Cloudflare list responses use null when a record has no comment. */
    comment?: string | null;
    tags?: string[] | null;
    settings?: Record<string, unknown> | null;
}

export interface CloudflareDnsSnapshot {
    zoneId: string;
    hostname: string;
    records: CloudflareDnsRecordSnapshot[];
}

export interface CloudflareDnsCutoverResult {
    changed: boolean;
    /** Exact readback after the candidate record was committed. */
    committed: CloudflareDnsSnapshot;
}

export interface CloudflareTunnelObserved {
    exists: boolean;
    status?: "inactive" | "degraded" | "healthy" | "down";
    connectorCount?: number;
}

/** Read every DNS record at the exact hostname before a possible cutover. */
export async function snapshotCloudflareDns(
    zoneId: string,
    hostname: string,
): Promise<CloudflareDnsSnapshot> {
    const query = new URLSearchParams({ "name.exact": hostname, per_page: "5000000" });
    const records = await cloudflareApiRequest<CloudflareDnsRecordSnapshot[]>(
        "GET",
        `/zones/${encodeURIComponent(zoneId)}/dns_records?${query.toString()}`,
    );
    return {
        zoneId,
        hostname: hostname.toLowerCase(),
        records: records.filter((record) => record.name.toLowerCase() === hostname.toLowerCase()),
    };
}

export function dnsSnapshotPointsToTunnel(
    snapshot: CloudflareDnsSnapshot,
    tunnelId: string,
): boolean {
    return snapshot.records.length === 1 &&
        snapshot.records[0]?.proxied === true &&
        dnsRecordTargetsTunnel(snapshot.records[0], tunnelId);
}

export function dnsSnapshotReferencesTunnel(
    snapshot: CloudflareDnsSnapshot,
    tunnelId: string,
): boolean {
    return snapshot.records.some((record) => dnsRecordTargetsTunnel(record, tunnelId));
}

/** Remove a former codex-mcp hostname only while it still exactly targets that managed Tunnel. */
export async function removeCloudflareManagedDnsIfOwned(
    zoneId: string,
    hostname: string,
    tunnelId: string,
): Promise<boolean> {
    const snapshot = await snapshotCloudflareDns(zoneId, hostname);
    if (!dnsSnapshotPointsToTunnel(snapshot, tunnelId)) return false;
    await deleteDnsRecords(zoneId, snapshot.records);
    return true;
}

function dnsRecordTargetsTunnel(
    record: CloudflareDnsRecordSnapshot,
    tunnelId: string,
): boolean {
    const expected = `${tunnelId}.cfargotunnel.com`;
    return record.type === "CNAME" &&
        record.content?.toLowerCase().replace(/\.$/, "") === expected;
}

/** Replace the exact-name DNS set with one proxied Tunnel CNAME. */
export async function cutoverCloudflareDns(
    snapshot: CloudflareDnsSnapshot,
    tunnelId: string,
): Promise<CloudflareDnsCutoverResult> {
    if (dnsSnapshotPointsToTunnel(snapshot, tunnelId)) {
        return { changed: false, committed: snapshot };
    }
    const current = await snapshotCloudflareDns(snapshot.zoneId, snapshot.hostname);
    if (!dnsRecordsEquivalent(current.records, snapshot.records)) {
        throw new Error("DNS records changed after confirmation; switching stopped. Run setup again to check the latest state");
    }
    try {
        await deleteDnsRecords(snapshot.zoneId, current.records);
        await createDnsRecord(snapshot.zoneId, {
            type: "CNAME",
            name: snapshot.hostname,
            content: `${tunnelId}.cfargotunnel.com`,
            ttl: 1,
            proxied: true,
        });
        const committed = await snapshotCloudflareDns(snapshot.zoneId, snapshot.hostname);
        if (!dnsSnapshotPointsToTunnel(committed, tunnelId)) {
            throw new Error("DNS read-back verification did not match after writing");
        }
        return { changed: true, committed };
    } catch (error) {
        try {
            await restorePartialCloudflareDns(snapshot, tunnelId);
        } catch (restoreError) {
            throw partialDnsError("DNS switch failed and previous records could not be restored", error, restoreError);
        }
        throw new Error(`DNS switch failed; previous records restored: ${readableError(error)}`);
    }
}

/**
 * Restore the old set only when no actor changed the fully committed candidate.
 * This is the post-cutover/public-verification compensation boundary.
 */
export async function restoreCloudflareDns(
    snapshot: CloudflareDnsSnapshot,
    expectedCurrent: CloudflareDnsSnapshot,
): Promise<void> {
    if (
        snapshot.zoneId !== expectedCurrent.zoneId ||
        snapshot.hostname !== expectedCurrent.hostname
    ) {
        throw new Error("DNS rollback snapshot belongs to a different hostname");
    }
    const current = await snapshotCloudflareDns(snapshot.zoneId, snapshot.hostname);
    if (dnsRecordsEquivalent(current.records, snapshot.records)) return;
    if (!dnsRecordsEquivalent(current.records, expectedCurrent.records)) {
        throw new Error(
            "DNS was changed by another operation after switching. Refusing to overwrite new records; inspect Cloudflare and restore manually",
        );
    }
    await replaceDnsRecords(snapshot, current);
}

/** Internal recovery while this process is still in the middle of cutover. */
async function restorePartialCloudflareDns(
    snapshot: CloudflareDnsSnapshot,
    expectedTunnelId: string,
): Promise<void> {
    const current = await snapshotCloudflareDns(snapshot.zoneId, snapshot.hostname);
    const safeRecoveryState =
        current.records.length === 0 ||
        dnsRecordsEquivalent(current.records, snapshot.records) ||
        dnsRecordsAreSubset(current.records, snapshot.records) ||
        dnsSnapshotPointsToTunnel(current, expectedTunnelId);
    if (!safeRecoveryState) {
        throw new Error(
            "DNS was changed by another operation during switching. Refusing to overwrite new records; inspect Cloudflare and restore manually",
        );
    }
    if (dnsRecordsEquivalent(current.records, snapshot.records)) return;
    await replaceDnsRecords(snapshot, current);
}

async function replaceDnsRecords(
    snapshot: CloudflareDnsSnapshot,
    current: CloudflareDnsSnapshot,
): Promise<void> {
    await deleteDnsRecords(snapshot.zoneId, current.records);
    for (const record of snapshot.records) {
        await createDnsRecord(snapshot.zoneId, dnsCreateBody(record));
    }
    const restored = await snapshotCloudflareDns(snapshot.zoneId, snapshot.hostname);
    if (!dnsRecordsEquivalent(restored.records, snapshot.records)) {
        throw new Error("DNS restoration request completed, but read-back still differs from the original snapshot");
    }
}

export async function inspectCloudflareTunnel(
    accountId: string,
    tunnelId: string,
): Promise<CloudflareTunnelObserved> {
    const normalizedTunnelId = normalizeTunnelId(tunnelId);
    try {
        const tunnel = await cloudflareApiRequest<{ status?: unknown; deleted_at?: unknown }>(
            "GET",
            `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(normalizedTunnelId)}`,
        );
        // Cloudflare soft-deletes tunnels: the detail endpoint can keep returning
        // HTTP 200 with deleted_at populated even though the tunnel disappeared
        // from the active list. Treat that state as absent and do not query
        // connections for an object that can no longer be used.
        if (isDeletedCloudflareTunnelRecord(tunnel)) return { exists: false };
        const connections = await cloudflareApiRequest<unknown[]>(
            "GET",
            `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(normalizedTunnelId)}/connections`,
        );
        const status = isTunnelStatus(tunnel.status) ? tunnel.status : undefined;
        return { exists: true, ...(status ? { status } : {}), connectorCount: connections.length };
    } catch (error) {
        if (/not found|HTTP 404/i.test(readableError(error))) return { exists: false };
        throw error;
    }
}

async function deleteDnsRecords(
    zoneId: string,
    records: CloudflareDnsRecordSnapshot[],
): Promise<void> {
    for (const record of records) {
        await cloudflareApiRequest<unknown>(
            "DELETE",
            `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(record.id)}`,
        );
    }
}

function dnsRecordsEquivalent(
    left: CloudflareDnsRecordSnapshot[],
    right: CloudflareDnsRecordSnapshot[],
): boolean {
    return recordFingerprints(left).join("\n") === recordFingerprints(right).join("\n");
}

function dnsRecordsAreSubset(
    subset: CloudflareDnsRecordSnapshot[],
    superset: CloudflareDnsRecordSnapshot[],
): boolean {
    const remaining = recordFingerprints(superset);
    for (const fingerprint of recordFingerprints(subset)) {
        const index = remaining.indexOf(fingerprint);
        if (index < 0) return false;
        remaining.splice(index, 1);
    }
    return true;
}

function recordFingerprints(records: CloudflareDnsRecordSnapshot[]): string[] {
    return records.map((record) => stableStringify(dnsCreateBody(record))).sort();
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        const fields = Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, field]) => `${JSON.stringify(key)}:${stableStringify(field)}`);
        return `{${fields.join(",")}}`;
    }
    return JSON.stringify(value);
}

async function createDnsRecord(
    zoneId: string,
    body: Record<string, unknown>,
): Promise<void> {
    await cloudflareApiRequest<unknown>(
        "POST",
        `/zones/${encodeURIComponent(zoneId)}/dns_records`,
        body,
    );
}

function dnsCreateBody(record: CloudflareDnsRecordSnapshot): Record<string, unknown> {
    const usesData = DNS_TYPES_WITH_DATA.has(record.type.toUpperCase());
    return {
        type: record.type,
        name: record.name,
        ttl: record.ttl,
        ...(!usesData && typeof record.content === "string" ? { content: record.content } : {}),
        ...(typeof record.proxied === "boolean" ? { proxied: record.proxied } : {}),
        ...(typeof record.private_routing === "boolean" ? { private_routing: record.private_routing } : {}),
        ...(typeof record.priority === "number" ? { priority: record.priority } : {}),
        ...(usesData && isRecordObject(record.data) ? { data: record.data } : {}),
        ...(typeof record.comment === "string" ? { comment: record.comment } : {}),
        ...(Array.isArray(record.tags) && record.tags.every((tag) => typeof tag === "string")
            ? { tags: record.tags }
            : {}),
        ...(isRecordObject(record.settings) ? { settings: record.settings } : {}),
    };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function cloudflareApiRequest<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
): Promise<T> {
    const token = readManagedCloudflareOriginToken();
    try {
        const requestBody = body ? JSON.stringify(body) : undefined;
        const response = await safeHttpRequest(`${CLOUDFLARE_API_BASE}${path}`, {
            method,
            httpsOnly: true,
            maxRedirects: 0,
            maxBytes: MAX_API_BODY_CHARS,
            timeoutMs: API_TIMEOUT_MS,
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${token.apiToken}`,
                ...(body ? { "Content-Type": "application/json" } : {}),
            },
            ...(requestBody ? { body: requestBody } : {}),
        });
        const text = response.body.toString("utf8");
        let payload: CloudflareApiEnvelope<T>;
        try {
            payload = JSON.parse(text) as CloudflareApiEnvelope<T>;
        } catch {
            throw new Error(`Cloudflare API returned unrecognized content (HTTP ${response.status})`);
        }
        if (response.status < 200 || response.status >= 300 || payload.success !== true || payload.result === undefined) {
            const detail = payload.errors
                ?.map((item) => item.message?.trim())
                .filter((value): value is string => Boolean(value))
                .join("; ");
            throw new Error(detail || `Cloudflare API request failed (HTTP ${response.status})`);
        }
        return payload.result;
    } catch (error) {
        if (/timed out|timeout/i.test(readableError(error))) {
            throw new Error("Cloudflare API request did not finish within 30 seconds");
        }
        throw error;
    }
}

function partialDnsError(prefix: string, original: unknown, restore: unknown): Error {
    return new Error(
        `${prefix}. Original error: ${readableError(original)}; restoration error: ${readableError(restore)}.` +
        "Cloudflare may be partially modified. Run `codex-mcp doctor` before overwriting DNS again.",
    );
}

function readableError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function isDeletedCloudflareTunnelRecord(value: { deleted_at?: unknown }): boolean {
    return value.deleted_at !== undefined && value.deleted_at !== null;
}

function isTunnelStatus(
    value: unknown,
): value is "inactive" | "degraded" | "healthy" | "down" {
    return value === "inactive" || value === "degraded" || value === "healthy" || value === "down";
}
