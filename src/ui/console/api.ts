export interface RuntimeIntent {
    local: boolean;
    noTunnel: boolean;
    tunnelLogs: boolean;
}

export interface RuntimeInfo {
    pid: number;
    version: string;
    mode: string;
    localUrl: string;
    publicMcpUrl?: string;
    runtimeIntent: RuntimeIntent;
    tunnel?: { state?: string };
    auth?: { required?: boolean; configured?: boolean };
}

export interface ControllerStatus {
    pid: number;
    version: string;
    uptimeMs: number;
    runtime: { running: boolean; runtime?: RuntimeInfo; projects: Project[] };
}

export interface Project {
    id: string;
    name: string;
    path: string;
    active: boolean;
    boundSessions?: number;
}

export interface Conversation { id: string; projectId: string; label: string; lastSeenAt: string; }
export interface ProjectSuggestion { name: string; path: string; source: "recent" | "discovered"; }
export interface ConnectionCheck {
    checkedAt: string;
    ready: boolean;
    checks: Array<{ id: string; label: string; state: "passed" | "failed" | "pending"; detail: string; action?: "start" | "connect" | "projects" | "repair" }>;
}

export interface CapabilitySource {
    enabled: boolean;
    mcp: boolean;
    skills: boolean;
}

export interface CapabilityConfig {
    sync: "watch" | "startup";
    priority: string[];
    sources: Record<string, CapabilitySource>;
}

export interface SetupConfigState {
    publicAccess?: { kind: "external" | "cloudflare"; domain: string };
    runtime?: { mode: "local" | "public"; noTunnel?: boolean; tunnelLogs?: boolean };
}

export interface SetupSummary {
    config: SetupConfigState;
    passwordConfigured: boolean;
    capabilities: CapabilityConfig;
    detections: Array<{ id?: string; label: string; detected: boolean }>;
}

export interface ConsoleSnapshot {
    status: ControllerStatus;
    setup: { config: SetupConfigState; passwordConfigured: boolean };
    conversations: Conversation[];
}

export interface OperationSnapshot {
    id: string;
    kind: string;
    state: "running" | "succeeded" | "failed" | "cancelled";
    phase: string;
    messages: string[];
    result?: unknown;
    error?: string;
}

const root = document.getElementById("console-root");
const csrf = root?.dataset.csrfToken ?? "";

export const consoleVersion = root?.dataset.version ?? "";

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {};
    if (method !== "GET" && method !== "HEAD") {
        headers["x-csrf-token"] = csrf;
        headers["content-type"] = "application/json";
    }
    const response = await fetch(path, {
        method,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        signal: options.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let data: { error?: string };
    try {
        data = await response.json() as { error?: string };
    } catch {
        throw new Error("The console did not return a readable result");
    }
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data as T;
}

export function friendlyError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/unauthorized|session/i.test(message)) return "The page session has expired. Refresh and try again.";
    if (/invalid origin|csrf/i.test(message)) return "Security check failed. Refresh the page and try again.";
    if (/EADDRINUSE|address already in use/i.test(message)) return "The service port is in use by another program. Stop the duplicate service first.";
    if (/password.*12|at least 12/i.test(message)) return "The connection password must contain at least 12 characters.";
    if (/not configured|public access is not configured/i.test(message)) return "Complete ChatGPT connection setup first.";
    if (/timeout|timed out/i.test(message)) return "The operation timed out. Check your network and try again.";
    if (/failed to fetch|fetch failed|networkerror|network request failed/i.test(message)) {
        return "Web Console lost its connection to the local Controller. If you just ran shutdown, run codex-mcp open to reopen it.";
    }
    return message;
}

export function followOperation(
    operation: OperationSnapshot,
    onUpdate: (snapshot: OperationSnapshot) => void,
    onDone?: (snapshot: OperationSnapshot) => void,
): () => void {
    let closed = false;
    let finished = false;
    let fallbackTimer: number | undefined;
    const source = new EventSource(`/api/operations/${encodeURIComponent(operation.id)}/events`);
    const clearFallback = (): void => {
        if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
    };
    const accept = (snapshot: OperationSnapshot): void => {
        if (closed || finished) return;
        onUpdate(snapshot);
        if (snapshot.state !== "running") {
            finished = true;
            clearFallback();
            source.close();
            onDone?.(snapshot);
        }
    };
    const pollFallback = async (): Promise<void> => {
        fallbackTimer = undefined;
        if (closed || finished || source.readyState === EventSource.OPEN) return;
        try {
            const payload = await api<{ operation: OperationSnapshot }>(`/api/operations/${encodeURIComponent(operation.id)}`);
            accept(payload.operation);
        } catch {
            // EventSource keeps reconnecting; the ordinary console sync surfaces a Controller outage.
        }
        if (!closed && !finished && source.readyState !== EventSource.OPEN && fallbackTimer === undefined) {
            fallbackTimer = window.setTimeout(() => { void pollFallback(); }, 1_000);
        }
    };

    accept(operation);
    source.onopen = clearFallback;
    source.onerror = () => {
        if (!closed && !finished && fallbackTimer === undefined) {
            fallbackTimer = window.setTimeout(() => { void pollFallback(); }, 500);
        }
    };
    source.addEventListener("operation", (event) => {
        accept(JSON.parse((event as MessageEvent).data) as OperationSnapshot);
    });
    return () => {
        closed = true;
        clearFallback();
        source.close();
    };
}
