const TUNNEL_ID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalize a Cloudflare Tunnel UUID before using it in paths or API calls. */
export function normalizeTunnelId(value: unknown, field = "Tunnel ID"): string {
    if (typeof value !== "string" || !TUNNEL_ID_RE.test(value.trim())) {
        throw new Error(`${field} has an invalid format`);
    }
    return value.trim().toLowerCase();
}
