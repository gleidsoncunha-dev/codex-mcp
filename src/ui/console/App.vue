<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
    Connection, Expand, Fold, FolderOpened, HomeFilled, InfoFilled, Refresh, Setting, SwitchButton, Tools, VideoPause, VideoPlay,
} from "@element-plus/icons-vue";
import en from "element-plus/es/locale/lang/en";
import { ElMessage } from "element-plus/es/components/message/index";
import { ElMessageBox } from "element-plus/es/components/message-box/index";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import {
    api, consoleVersion, followOperation, friendlyError,
    type CapabilityConfig, type ConnectionCheck, type ConsoleSnapshot, type ControllerStatus, type Conversation,
    type OperationSnapshot, type Project, type SetupSummary,
} from "./api.js";
import AddProjectDialog from "./components/AddProjectDialog.vue";
import HomeView from "./views/HomeView.vue";
import ProjectsView from "./views/ProjectsView.vue";
import ConnectView from "./views/ConnectView.vue";
import MaintenanceView from "./views/MaintenanceView.vue";

type Page = "home" | "projects" | "connect" | "maintenance";
type OperationScope = "connect" | "maintenance";

const navigation = [
    { id: "home" as const, label: "Overview", icon: HomeFilled },
    { id: "projects" as const, label: "Projects", icon: FolderOpened },
    { id: "connect" as const, label: "Connection", icon: Connection },
    { id: "maintenance" as const, label: "System", icon: Tools },
];

const page = ref<Page>("home");
const sidebarCollapsed = ref(false);
const addOpen = ref(false);
const detailsOpen = ref(false);
const controllerClosed = ref(false);
const status = ref<ControllerStatus>();
const projects = ref<Project[]>([]);
const conversations = ref<Conversation[]>([]);
const setup = ref<SetupSummary>();
const connectionResult = ref<ConnectionCheck>();
const loading = ref(true);
const refreshing = ref(false);
const busyOwners = ref(0);
const loadError = ref("");
const syncError = ref("");
const zones = ref<string[]>([]);
const operations = ref<Partial<Record<OperationScope, OperationSnapshot>>>({});
const operationCleanups = new Map<string, { close: () => void; release: () => void }>();
let pollTimer: number | undefined;
let liveRefresh: Promise<void> | undefined;
const LIVE_SYNC_MS = 2_000;

const busy = computed(() => busyOwners.value > 0 || refreshing.value);
const running = computed(() => status.value?.runtime.running === true);
const pageTitle = computed(() => navigation.find((item) => item.id === page.value)?.label ?? "Overview");
const liveRuntime = computed(() => status.value?.runtime.runtime);
const checkContext = computed(() => JSON.stringify([
    status.value?.runtime.running,
    status.value?.runtime.runtime?.pid,
    setup.value?.config.publicAccess,
    setup.value?.passwordConfigured,
    projects.value.map((project) => [project.id, project.active]),
]));
watch(checkContext, () => { connectionResult.value = undefined; });

function applySnapshot(snapshot: ConsoleSnapshot): void {
    status.value = snapshot.status;
    projects.value = snapshot.status.runtime.projects ?? [];
    conversations.value = snapshot.conversations;
    if (setup.value) {
        setup.value = {
            ...setup.value,
            config: snapshot.setup.config,
            passwordConfigured: snapshot.setup.passwordConfigured,
        };
    }
}

async function refreshLive(showError = false): Promise<void> {
    if (controllerClosed.value) return;
    if (liveRefresh) return await liveRefresh;
    liveRefresh = (async () => {
        try {
            applySnapshot(await api<ConsoleSnapshot>("/api/console/snapshot"));
            syncError.value = "";
            if (showError) loadError.value = "";
        } catch (error) {
            syncError.value = friendlyError(error);
            if (showError) loadError.value = syncError.value;
        }
    })();
    try { await liveRefresh; }
    finally { liveRefresh = undefined; }
}

async function refreshAll(showError = true): Promise<void> {
    refreshing.value = true;
    try {
        if (liveRefresh) await liveRefresh;
        const results = await Promise.allSettled([
            api<ConsoleSnapshot>("/api/console/snapshot"),
            api<SetupSummary>("/api/setup/summary"),
        ]);
        if (results[0].status === "fulfilled") { applySnapshot(results[0].value); syncError.value = ""; }
        if (results[1].status === "fulfilled") setup.value = results[1].value;
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed && showError) loadError.value = friendlyError(failed.reason);
        else if (!failed) loadError.value = "";
    } finally {
        refreshing.value = false;
        loading.value = false;
    }
}

function syncPageFromLocation(): void {
    const requested = window.location.hash.replace(/^#/, "");
    const match = navigation.find((item) => item.id === requested || (requested === "system" && item.id === "maintenance"));
    if (match) page.value = match.id;
}
function refreshWhenVisible(): void {
    if (document.visibilityState === "visible") void refreshLive(false);
}

onMounted(() => {
    syncPageFromLocation();
    void refreshAll();
    pollTimer = window.setInterval(() => {
        if (document.visibilityState === "visible" && !refreshing.value) void refreshLive(false);
    }, LIVE_SYNC_MS);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("popstate", syncPageFromLocation);
    window.addEventListener("hashchange", syncPageFromLocation);
    document.addEventListener("visibilitychange", refreshWhenVisible);
});
onBeforeUnmount(() => {
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    window.removeEventListener("focus", refreshWhenVisible);
    window.removeEventListener("popstate", syncPageFromLocation);
    window.removeEventListener("hashchange", syncPageFromLocation);
    document.removeEventListener("visibilitychange", refreshWhenVisible);
    for (const owner of operationCleanups.values()) { owner.close(); owner.release(); }
    operationCleanups.clear();
});

function claimBusy(): () => void {
    busyOwners.value += 1;
    let active = true;
    return () => {
        if (!active) return;
        active = false;
        busyOwners.value = Math.max(0, busyOwners.value - 1);
    };
}

async function runAction(action: () => Promise<void>, successMessage?: string): Promise<boolean> {
    const release = claimBusy();
    try {
        await action();
        if (successMessage) ElMessage.success(successMessage);
        return true;
    } catch (error) {
        ElMessage.error(friendlyError(error));
        return false;
    } finally {
        release();
    }
}

async function startOperation(
    scope: OperationScope,
    path: string,
    body: unknown,
    successMessage: string,
    onDone?: (result: unknown) => void | Promise<void>,
): Promise<void> {
    const release = claimBusy();
    try {
        const response = await api<{ operation: OperationSnapshot }>(path, { method: "POST", body });
        const finish = async (snapshot: OperationSnapshot): Promise<void> => {
            const owner = operationCleanups.get(snapshot.id);
            try {
                if (snapshot.state === "succeeded") {
                    await onDone?.(snapshot.result);
                    ElMessage.success(successMessage);
                } else if (snapshot.state === "failed") {
                    ElMessage.error(friendlyError(snapshot.error ?? "ActionIncomplete"));
                }
            } catch (error) {
                ElMessage.error(friendlyError(error));
            } finally {
                owner?.release();
                operationCleanups.delete(snapshot.id);
            }
        };
        const close = followOperation(response.operation, (snapshot) => {
            operations.value = { ...operations.value, [scope]: snapshot };
        }, (snapshot) => { void finish(snapshot); });
        operationCleanups.set(response.operation.id, { close, release });
    } catch (error) {
        release();
        ElMessage.error(friendlyError(error));
    }
}

async function confirmAction(title: string, description: string, confirmLabel: string, action: () => unknown | Promise<unknown>, danger = false): Promise<void> {
    try {
        await ElMessageBox.confirm(description, title, {
            confirmButtonText: confirmLabel,
            cancelButtonText: "Cancel",
            type: danger ? "warning" : "info",
            distinguishCancelAndClose: true,
        });
        await action();
    } catch (error) {
        if (error === "cancel" || error === "close") return;
        throw error;
    }
}

function navigate(next: Page): void {
    page.value = next;
    const hash = next === "maintenance" ? "system" : next;
    if (window.location.hash !== `#${hash}`) window.history.pushState(null, "", `#${hash}`);
}
function handleMenuSelect(value: string): void { navigate(value as Page); }

function startRuntime(mode: "local" | "public"): void {
    void runAction(async () => {
        connectionResult.value = undefined;
        await api("/api/runtime/start", {
            method: "POST",
            body: mode === "local"
                ? { local: true, noTunnel: true, tunnelLogs: false, intentSpecified: true }
                : { local: false, noTunnel: false, tunnelLogs: false, intentSpecified: true },
        });
        await refreshLive(false);
    }, mode === "local" ? "MCP started in local mode" : "MCP started in public mode");
}
function restartRuntime(): void {
    void runAction(async () => {
        connectionResult.value = undefined;
        await api("/api/runtime/restart", { method: "POST", body: {} });
        await refreshLive(false);
    }, "MCP service restarted");
}
function stopRuntime(): void {
    void confirmAction("Stop the MCP service?", "ChatGPT and other clients will temporarily lose access to projects. The control panel will keep running.", "Stop service", () => runAction(async () => {
        connectionResult.value = undefined;
        await api("/api/runtime/stop", { method: "POST", body: {} });
        await refreshLive(false);
    }, "MCP service stopped"), true);
}
function shutdownAll(): void {
    void confirmAction("Shut down codex-mcp completely?", "MCP Runtime, Tunnel, and Web Console will exit. Project and connection settings will be preserved.", "Shut down", () => runAction(async () => {
        await api("/api/controller/shutdown", { method: "POST", body: {} });
        if (pollTimer !== undefined) window.clearInterval(pollTimer);
        pollTimer = undefined;
        detailsOpen.value = false;
        controllerClosed.value = true;
    }, "codex-mcp shut down"), true);
}
async function addProject(path: string): Promise<boolean> {
    return await runAction(async () => {
        await api("/api/projects", { method: "POST", body: { path } });
        connectionResult.value = undefined;
        await refreshLive(false);
    }, "Project added");
}
function reactivateProject(project: Project): void {
    void runAction(async () => {
        await api("/api/projects", { method: "POST", body: { path: project.path } });
        connectionResult.value = undefined;
        await refreshLive(false);
    }, "Project reactivated");
}
function removeProject(project: Project): void {
    void confirmAction(`Deactivate ${project.name}?`, "Project files will be kept, but ChatGPT will lose access and existing session bindings will be cleared.", "Deactivate project", () => runAction(async () => {
        await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE", body: {} });
        await refreshLive(false);
    }, "ProjectInactive"), true);
}
function cleanupConversations(project: Project, conversationIds: string[]): void {
    if (!conversationIds.length) return;
    void confirmAction("Clear session bindings?", `Clear project selections for ${conversationIds.length} sessions. ChatGPT conversations and project files will be kept.`, "Clear bindings", () => runAction(async () => {
        await api(`/api/projects/${encodeURIComponent(project.id)}/conversations/cleanup`, { method: "POST", body: { conversationIds } });
        await refreshLive(false);
    }, "Session bindings cleared"), true);
}
function discoverCloudflare(): void {
    void startOperation("connect", "/api/setup/cloudflare/discover", { forceLogin: false }, "Available domains loaded", (result) => {
        zones.value = (result as { zones?: string[] } | undefined)?.zones ?? [];
    });
}
function applyCloudflare(zone: string, prefix: string, overwrite: boolean): void {
    const action = () => startOperation("connect", "/api/setup/public/cloudflare", { zone, prefix, allowDnsOverwrite: overwrite }, "ChatGPT connection addressConfigured", () => refreshLive(false));
    if (!overwrite) { void action(); return; }
    void confirmAction("Allow replacement of an existing DNS record?", `If ${prefix}.${zone} is used by another service, its existing record will be replaced.`, "Allow and continue", action, true);
}
function applyExternal(domain: string): void {
    void startOperation("connect", "/api/setup/public/external", { domain }, "Custom domain saved and verified", () => refreshLive(false));
}
function checkPublicAccess(): void {
    void runAction(async () => {
        connectionResult.value = undefined;
        connectionResult.value = await api<ConnectionCheck>("/api/connection-check", { method: "POST", body: {} });
    });
}
async function savePassword(password: string): Promise<void> {
    await runAction(async () => {
        await api("/api/auth/password", { method: "POST", body: { password } });
        await refreshLive(false);
    }, "Connection password saved");
}
async function generatePassword(): Promise<string | undefined> {
    let password: string | undefined;
    await runAction(async () => {
        password = (await api<{ password: string }>("/api/auth/generate", { method: "POST", body: {} })).password;
        await refreshLive(false);
    }, "Secure password generated and set");
    return password;
}
async function saveCapabilities(config: CapabilityConfig): Promise<void> {
    await runAction(async () => {
        const sources = { ...config.sources, agents: { ...config.sources.agents, mcp: false } };
        await api("/api/setup/capabilities", { method: "POST", body: { config: { ...config, priority: ["agents", "codex", "claude"], sources } } });
        await refreshAll(false);
    }, "Tool settings saved");
}
function runDoctor(fix: boolean): void {
    const action = () => startOperation("maintenance", "/api/doctor", { fix }, fix ? "Checks and repairs complete" : "Service checks complete");
    if (!fix) { void action(); return; }
    void confirmAction("Check and repair common issues?", "Only restore missing file search tools, create missing directories, and clear stale state. Projects and settings will be kept.", "Start repair", action);
}
function selfUpdate(): void {
    void confirmAction("Check for and install the latest version?", "MCP service and the control panel will briefly restart. Project and connection settings will be preserved.", "Check and update", () => startOperation("maintenance", "/api/update", {}, "New version installed", (result) => {
        const reloadUrl = (result as { reloadUrl?: string } | undefined)?.reloadUrl;
        if (reloadUrl) window.setTimeout(() => { window.location.href = reloadUrl; }, 800);
    }));
}
function cancelOperation(id: string): void {
    void runAction(async () => { await api(`/api/operations/${encodeURIComponent(id)}`, { method: "DELETE", body: {} }); }, "Operation cancellation requested");
}
function handleResultAction(action: "start" | "connect" | "projects" | "repair"): void {
    if (action === "start") startRuntime(setup.value?.config.publicAccess && setup.value.passwordConfigured ? "public" : "local");
    else if (action === "projects") addOpen.value = true;
    else if (action === "repair") { navigate("maintenance"); runDoctor(true); }
    else navigate("connect");
}
</script>

<template>
    <el-config-provider :locale="en">
    <div v-if="controllerClosed" class="console-closed">
        <div class="console-closed-card">
            <div class="console-logo">C</div>
            <h1>codex-mcp shut down</h1>
            <p>Runtime and Web Console have exited. Project and connection settings are preserved.</p>
            <code>codex-mcp open</code>
            <div class="muted small">Run the command above in a terminal to reopen the console.</div>
        </div>
    </div>
    <div v-else class="console-shell" :class="{ 'is-sidebar-collapsed': sidebarCollapsed }">
        <aside class="console-sidebar">
            <div class="console-brand" :class="{ 'is-collapsed': sidebarCollapsed }">
                <span class="console-logo">C</span>
                <span v-if="!sidebarCollapsed" class="console-brand-text">codex-mcp</span>
            </div>
            <el-menu class="console-menu" :default-active="page" :collapse="sidebarCollapsed" :collapse-transition="false" @select="handleMenuSelect">
                <el-menu-item v-for="item in navigation" :key="item.id" :index="item.id">
                    <el-icon><component :is="item.icon" /></el-icon>
                    <template #title>{{ item.label }}</template>
                </el-menu-item>
            </el-menu>
            <div class="console-sidebar-footer">
                <el-tooltip :content="sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'" placement="right">
                    <el-button text class="console-collapse" :aria-label="sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'" @click="sidebarCollapsed = !sidebarCollapsed">
                        <el-icon size="18"><Expand v-if="sidebarCollapsed" /><Fold v-else /></el-icon>
                        <span v-if="!sidebarCollapsed">Collapse navigation</span>
                    </el-button>
                </el-tooltip>
                <div v-if="!sidebarCollapsed" class="console-version">Local workspace · v{{ consoleVersion }}</div>
            </div>
        </aside>

        <main class="console-main">
            <header class="console-topbar">
                <el-select :model-value="page" class="console-mobile-nav" @change="handleMenuSelect"><el-option v-for="item in navigation" :key="item.id" :label="item.label" :value="item.id" /></el-select>
                <h2 class="console-title">{{ pageTitle }}</h2>
                <div class="inline-actions" style="margin-left: auto">
                    <el-tag :type="loading ? 'info' : running ? 'success' : 'warning'" effect="light">{{ loading ? "Connecting" : running ? "Service running" : "Service stopped" }}</el-tag>
                    <el-button circle text :icon="Refresh" :loading="refreshing" aria-label="Refresh" @click="refreshAll()" />
                    <el-button circle text :icon="InfoFilled" aria-label="Technical details" @click="detailsOpen = true" />
                </div>
            </header>

            <div class="console-content">
                <el-alert v-if="loadError || syncError" type="error" :closable="false" :title="loadError || syncError" style="margin-bottom: 16px" />
                <HomeView v-if="page === 'home'" :status="status" :setup="setup" :projects="projects" :conversation-count="conversations.length" :loading="loading" :busy="busy" :result="connectionResult" @navigate="navigate" @add="addOpen = true" @start="startRuntime" @stop="stopRuntime" @check="checkPublicAccess" @repair="navigate('maintenance'); runDoctor(true)" />
                <ProjectsView v-else-if="page === 'projects'" :projects="projects" :conversations="conversations" :busy="busy" @add="addOpen = true" @reactivate="reactivateProject" @remove="removeProject" @cleanup="cleanupConversations" />
                <ConnectView v-else-if="page === 'connect'" :setup="setup" :result="connectionResult" :operation="operations.connect" :zones="zones" :busy="busy" :save-password="savePassword" :generate-password="generatePassword" @check="checkPublicAccess" @discover="discoverCloudflare" @apply-cloudflare="applyCloudflare" @apply-external="applyExternal" @cancel-operation="cancelOperation" @result-action="handleResultAction" />
                <MaintenanceView v-else :setup="setup" :operation="operations.maintenance" :busy="busy" :save-capabilities="saveCapabilities" @doctor="runDoctor" @update="selfUpdate" @cancel-operation="cancelOperation" />
            </div>
        </main>

        <AddProjectDialog v-model="addOpen" :busy="busy" :add-project="addProject" />

        <el-drawer v-model="detailsOpen" title="Technical details" size="min(480px, 92vw)">
            <div class="inline-actions" style="margin-bottom: 18px"><el-button :icon="Setting" @click="detailsOpen = false; navigate('maintenance')">System</el-button><el-button :icon="VideoPlay" :disabled="busy || !running" @click="restartRuntime">Restart Runtime</el-button><el-button type="danger" plain :icon="VideoPause" :disabled="busy || !running" @click="stopRuntime">Stop Runtime</el-button><el-button type="danger" text :icon="SwitchButton" :disabled="busy" @click="shutdownAll">Shut down</el-button></div>
            <el-descriptions :column="1" border>
                <el-descriptions-item label="Controller">Running · PID {{ status?.pid ?? "—" }}</el-descriptions-item>
                <el-descriptions-item label="MCP Runtime">{{ running ? `Running · PID ${liveRuntime?.pid ?? "—"}` : "Stopped" }}</el-descriptions-item>
                <el-descriptions-item label="Run mode">{{ liveRuntime?.mode === "local" ? "Local only" : liveRuntime?.mode ?? "—" }}</el-descriptions-item>
                <el-descriptions-item label="Public connection">{{ liveRuntime?.publicMcpUrl ? "Connected" : "Disconnected" }}</el-descriptions-item>
                <el-descriptions-item label="Login protection">{{ liveRuntime?.auth?.required ? (liveRuntime.auth.configured ? "Enabled" : "Waiting for password setup") : "Local only, no login required" }}</el-descriptions-item>
                <el-descriptions-item label="Local address"><span class="mono small break-all">{{ liveRuntime?.localUrl ?? "—" }}</span></el-descriptions-item>
                <el-descriptions-item label="ChatGPT address"><span class="mono small break-all">{{ liveRuntime?.publicMcpUrl ?? (setup?.config.publicAccess ? `https://${setup.config.publicAccess.domain}/mcp` : "—") }}</span></el-descriptions-item>
            </el-descriptions>
            <div class="section-heading" style="margin-top: 24px"><div><h2>Common commands</h2></div></div>
            <div class="command-list"><div class="command-row"><code>codex-mcp status</code><span class="muted small">View status</span></div><div class="command-row"><code>codex-mcp start</code><span class="muted small">Start service</span></div><div class="command-row"><code>codex-mcp logs -f</code><span class="muted small">Follow logs</span></div><div class="command-row"><code>codex-mcp doctor</code><span class="muted small">Check for issues</span></div></div>
        </el-drawer>
    </div>
    </el-config-provider>
</template>
