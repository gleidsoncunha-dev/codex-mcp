<script setup lang="ts">
import { computed } from "vue";
import { CopyDocument, FolderAdd, Link, VideoPause, VideoPlay, Refresh, Tools } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus/es/components/message/index";
import "element-plus/es/components/message/style/css";
import type { ConnectionCheck, ControllerStatus, Project, SetupSummary } from "../api.js";
import ConnectionResult from "../components/ConnectionResult.vue";

const props = defineProps<{
    status?: ControllerStatus;
    setup?: SetupSummary;
    projects: Project[];
    conversationCount: number;
    loading: boolean;
    busy: boolean;
    result?: ConnectionCheck;
}>();
const emit = defineEmits<{
    navigate: [page: "projects" | "connect" | "maintenance"];
    add: [];
    start: [mode: "local" | "public"];
    stop: [];
    check: [];
    repair: [];
}>();

const running = computed(() => props.status?.runtime.running === true);
const activeProjects = computed(() => props.projects.filter((item) => item.active));
const publicUrl = computed(() => props.setup?.config.publicAccess ? `https://${props.setup.config.publicAccess.domain}/mcp` : "");
const configured = computed(() => Boolean(publicUrl.value && props.setup?.passwordConfigured));
const connectionDetail = computed(() => {
    if (props.result?.ready) return "Checks passed";
    if (!publicUrl.value) return "Public address required";
    if (!props.setup?.passwordConfigured) return "Password required";
    return props.result ? "Some checks need attention" : "Waiting for connection check";
});
const liveMode = computed(() => props.status?.runtime.runtime?.mode === "local" ? "local" : props.status?.runtime.runtime?.mode === "public" ? "public" : undefined);
const preferredMode = computed(() => props.setup?.config.runtime?.mode ?? (publicUrl.value ? "public" : "local"));

async function copyUrl(): Promise<void> {
    if (!publicUrl.value) return;
    try { await navigator.clipboard.writeText(publicUrl.value); ElMessage.success("Connection address copied"); }
    catch { ElMessage.error("Copy failed. Please copy manually."); }
}
</script>

<template>
    <div>
        <div class="page-heading">
            <h1>Overview</h1>
            <p>View MCP, ChatGPT connection, and project status. Open a page to manage it.</p>
        </div>

        <div class="metric-grid">
            <el-card class="metric-card" shadow="never"><div class="metric-label">MCP service</div><div class="metric-value">{{ loading ? "…" : running ? "Running" : "Stopped" }}</div><div class="metric-detail">{{ status?.runtime.runtime?.mode === "local" ? "Local only" : status?.runtime.runtime?.mode ?? "Waiting to start" }}</div></el-card>
            <el-card class="metric-card" shadow="never"><div class="metric-label">ChatGPT connection</div><div class="metric-value">{{ configured ? "Configured" : "Not configured" }}</div><div class="metric-detail">{{ connectionDetail }}</div></el-card>
            <el-card class="metric-card" shadow="never"><div class="metric-label">Projects</div><div class="metric-value">{{ activeProjects.length }}</div><div class="metric-detail">{{ projects.length - activeProjects.length }} inactive</div></el-card>
            <el-card class="metric-card" shadow="never"><div class="metric-label">Session bindings</div><div class="metric-value">{{ conversationCount }}</div><div class="metric-detail">Current project selections</div></el-card>
        </div>

        <div class="content-grid">
            <el-card shadow="never">
                <div class="section-heading">
                    <div><h2>Get started</h2><p>Suggested next steps based on the current status.</p></div>
                </div>
                <div v-if="!activeProjects.length" class="inline-actions"><el-button type="primary" :icon="FolderAdd" @click="emit('add')">Add project</el-button><span class="muted small">Registering a project does not start the MCP service.</span></div>
                <div v-else-if="!running && !configured" class="inline-actions"><el-button type="primary" :icon="Link" @click="emit('navigate', 'connect')">Set up ChatGPT connection</el-button><el-button :icon="VideoPlay" :loading="busy" @click="emit('start', 'local')">Start locally</el-button></div>
                <div v-else-if="!running" class="inline-actions"><el-button type="primary" :icon="VideoPlay" :loading="busy" @click="emit('start', 'public')">Start public service</el-button><el-button :loading="busy" @click="emit('start', 'local')">Start locally</el-button><span class="muted small">Current default: {{ preferredMode === 'public' ? 'Public' : 'Local' }}</span></div>
                <div v-else class="inline-actions"><el-button v-if="liveMode === 'local' && !configured" type="primary" :icon="Link" @click="emit('navigate', 'connect')">Set up ChatGPT connection</el-button><el-button v-else-if="liveMode === 'local' && configured" type="primary" :loading="busy" @click="emit('start', 'public')">Switch to public mode</el-button><el-button v-else-if="liveMode === 'public'" :loading="busy" @click="emit('start', 'local')">Switch to local mode</el-button><el-button v-if="liveMode === 'public'" type="primary" :icon="Refresh" :loading="busy" @click="emit('check')">Check connection</el-button><el-button :icon="Tools" @click="emit('repair')">Check and repair</el-button><el-button text type="danger" :icon="VideoPause" :disabled="busy" @click="emit('stop')">Stop service</el-button></div>

                <div style="margin-top: 22px">
                    <div class="status-line"><span class="status-label">ChatGPT address</span><div class="inline-actions" style="justify-content: flex-end"><code class="small break-all">{{ publicUrl || "Not configured yet" }}</code><el-button v-if="publicUrl" text :icon="CopyDocument" @click="copyUrl" /></div></div>
                    <div class="status-line"><span class="status-label">Current projects</span><div class="inline-actions" style="justify-content: flex-end"><el-tag v-for="project in activeProjects.slice(0, 5)" :key="project.id" effect="plain" @click="emit('navigate', 'projects')">{{ project.name }}</el-tag><el-button v-if="activeProjects.length > 5" text @click="emit('navigate', 'projects')">+{{ activeProjects.length - 5 }}</el-button></div></div>
                </div>
            </el-card>

            <el-card shadow="never">
                <div class="section-heading"><div><h2>Status</h2><p>Current service information.</p></div></div>
                <div class="status-line"><span class="status-label">Controller</span><el-tag type="success" effect="light">Running</el-tag></div>
                <div class="status-line"><span class="status-label">MCP Runtime</span><el-tag :type="running ? 'success' : 'info'" effect="light">{{ running ? (liveMode === 'public' ? 'Running publicly' : 'Running locally') : 'Stopped' }}</el-tag></div>
                <div class="status-line"><span class="status-label">Default startup</span><el-tag effect="plain">{{ preferredMode === 'public' ? 'Public mode' : 'Local mode' }}</el-tag></div>
                <div class="status-line"><span class="status-label">Public address</span><el-tag :type="publicUrl ? 'success' : 'warning'" effect="light">{{ publicUrl ? "Configured" : "Not configured" }}</el-tag></div>
                <div class="status-line"><span class="status-label">Connection password</span><el-tag :type="setup?.passwordConfigured ? 'success' : 'warning'" effect="light">{{ setup?.passwordConfigured ? "Set" : "Not set" }}</el-tag></div>
            </el-card>
        </div>

        <ConnectionResult style="margin-top: 16px" :result="result" @action="(action) => action === 'start' ? emit('start', configured ? 'public' : 'local') : action === 'projects' ? emit('add') : action === 'repair' ? emit('repair') : emit('navigate', 'connect')" />
    </div>
</template>
