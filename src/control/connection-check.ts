import { contactRunningDaemon } from "../daemon/control.js";
import { loadUserConfig } from "../config/user-config.js";
import { hasAdminPassword } from "../auth/password-store.js";
import { verifyRunningPublicRoute } from "../tunnel/setup-verify.js";
import { safeHttpGet } from "../lib/http/safe-http.js";

export interface ConnectionCheck {
    checkedAt: string;
    ready: boolean;
    checks: Array<{ id: string; label: string; state: "passed" | "failed" | "pending"; detail: string; action?: "start" | "connect" | "projects" | "repair" }>;
}

export async function checkConnection(): Promise<ConnectionCheck> {
    const checks: ConnectionCheck["checks"] = [];
    const daemon = await contactRunningDaemon();
    checks.push({ id: "service", label: "Local service", state: daemon ? "passed" : "failed", detail: daemon ? "The service is running." : "Start the service first.", ...(!daemon ? { action: "start" as const } : {}) });
    if (daemon) {
        try {
            const result = await daemon.client.checkTools();
            checks.push({ id: "tools", label: "Tools and projects", state: result.projectCount ? "passed" : "failed", detail: `Connected to tools and read the project list: ${result.toolCount} tools, ${result.projectCount} available projects.`, ...(!result.projectCount ? { action: "projects" as const } : {}) });
        } catch {
            checks.push({ id: "tools", label: "Tools and projects", state: "failed", detail: "Tool checks failed. Check or restart the service.", action: "repair" });
        }
    }
    const access = loadUserConfig().publicAccess;
    const configured = Boolean(access);
    const password = await hasAdminPassword();
    checks.push({ id: "password", label: "Connection password", state: password ? "passed" : "pending", detail: password ? "Connection password is set." : "Set a password before connecting ChatGPT securely.", ...(!password ? { action: "connect" as const } : {}) });
    if (access && daemon) {
        try {
            const status = await daemon.client.status();
            if (!status.auth.required || status.publicMcpUrl !== `https://${access.domain}/mcp`) {
                checks.push({ id: "public", label: "Public address", state: "pending", detail: "The service is running locally only. Start the ChatGPT connection.", action: "start" });
            } else {
                await verifyRunningPublicRoute(access.domain, daemon.state.host, daemon.state.port, { totalTimeoutMs: 10_000 });
                const challenge = await safeHttpGet(status.publicMcpUrl, { httpsOnly: true, maxBytes: 4096, maxRedirects: 0, timeoutMs: 10_000, headers: { Accept: "application/json, text/event-stream" } });
                if (challenge.status !== 401 || !challenge.headers["www-authenticate"]?.includes("Bearer")) throw new Error("Login protection did not respond as expected");
                checks.push({ id: "public", label: "Public address", state: "passed", detail: "The public address points to this service and login protection responds correctly." });
            }
        } catch {
            checks.push({ id: "public", label: "Public address", state: "failed", detail: "The public address is unavailable. Check connection settings.", action: "connect" });
        }
    } else {
        checks.push({ id: "public", label: "Public address", state: "pending", detail: configured ? "Start the service before checking the public address." : "Set up the ChatGPT connection address first.", action: configured ? "start" : "connect" });
    }
    return { checkedAt: new Date().toISOString(), ready: checks.every((item) => item.state === "passed"), checks };
}
