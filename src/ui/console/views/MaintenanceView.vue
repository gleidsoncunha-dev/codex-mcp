<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Download, Refresh, Tools } from "@element-plus/icons-vue";
import { api, friendlyError, type CapabilityConfig, type OperationSnapshot, type SetupSummary } from "../api.js";
import CapabilitiesPanel from "../components/CapabilitiesPanel.vue";
import OperationPanel from "../components/OperationPanel.vue";

interface DoctorResult {
    fixes?: string[];
    warnings?: string[];
    report?: { checks?: Array<{ level: "ok" | "warn" | "error"; label: string; detail: string }> };
}

const props = defineProps<{
    setup?: SetupSummary;
    operation?: OperationSnapshot;
    busy: boolean;
    saveCapabilities: (config: CapabilityConfig) => Promise<void>;
}>();
const emit = defineEmits<{ doctor: [fix: boolean]; update: []; cancelOperation: [id: string] }>();
const tab = ref("check");
const lines = ref(100);
const logs = ref("Logs have not been loaded yet.\n");
const logError = ref("");
let logSource: EventSource | undefined;

const doctor = computed(() => props.operation?.kind.startsWith("doctor") && props.operation.result ? props.operation.result as DoctorResult : undefined);

async function readLogs(): Promise<void> {
    try {
        lines.value = Math.max(1, Math.min(5000, Math.trunc(lines.value || 100)));
        const result = await api<{ text: string }>(`/api/logs?lines=${lines.value}`);
        logs.value = result.text || "No runtime logs available.\n";
        logError.value = "";
    } catch (error) {
        logError.value = friendlyError(error);
    }
}
function stopLogStream(): void { logSource?.close(); logSource = undefined; }
function startLogStream(): void {
    stopLogStream();
    void readLogs();
    logSource = new EventSource(`/api/logs/stream?lines=${lines.value}`);
    logSource.onopen = () => { logError.value = ""; };
    logSource.onerror = () => { logError.value = "Live log connection interrupted. Reconnecting automatically."; };
    logSource.addEventListener("logs", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as { text?: string };
        logs.value = data.text || "No runtime logs available.\n";
    });
}
watch(tab, (value) => value === "logs" ? startLogStream() : stopLogStream());
onBeforeUnmount(stopLogStream);

function friendlyCheck(label: string, detail: string): { title: string; detail: string } {
    const titles: Record<string, string> = {
        "Node.js": "Runtime environment", "Git": "Git tools", "File search": "File search", "Configuration file": "Local settings",
        "External capabilities": "Available tools and skills", "Connection password": "Connection password", "Public address": "ChatGPT connection address", "Daemon": "MCP service",
    };
    if (label === "Connection password" && /Not set/.test(detail)) return { title: titles[label]!, detail: "Not set. Open the Connection page to finish setup." };
    if (label === "Public address" && /Not set/.test(detail)) return { title: titles[label]!, detail: "Not configured. Set this up to connect from ChatGPT on the web." };
    if (label === "Daemon" && /^pid\s/i.test(detail)) return { title: titles[label]!, detail: "The service is running locally." };
    if (label === "Configuration file") return { title: titles[label]!, detail: "The settings file is readable." };
    return { title: titles[label] ?? label, detail };
}
function tagType(level: "ok" | "warn" | "error"): "success" | "warning" | "danger" { return level === "ok" ? "success" : level === "warn" ? "warning" : "danger"; }
</script>

<template>
    <div>
        <div class="page-heading"><h1>System</h1><p>Manage local capability sources, diagnose the environment, view logs, and update codex-mcp.</p></div>
        <el-card shadow="never">
            <el-tabs v-model="tab">
                <el-tab-pane label="Checks and repairs" name="check">
                    <div class="section-heading">
                        <div><h2>Service diagnostics</h2><p>Checks are read-only. Check and repair only performs safe local repairs.</p></div>
                        <div class="inline-actions"><el-button :disabled="busy" @click="emit('doctor', false)">Run checks</el-button><el-button type="primary" :icon="Tools" :disabled="busy" @click="emit('doctor', true)">Check and repair</el-button></div>
                    </div>
                    <OperationPanel v-if="operation?.kind.startsWith('doctor')" :operation="operation" @cancel="emit('cancelOperation', $event)" />
                    <div v-if="doctor?.fixes?.length || doctor?.warnings?.length || doctor?.report?.checks?.length" style="margin-top: 18px">
                        <div v-for="fix in doctor?.fixes" :key="fix" class="status-line"><div><strong>Repair complete</strong><div class="muted small">{{ fix }}</div></div><el-tag type="success">Done</el-tag></div>
                        <div v-for="warning in doctor?.warnings" :key="warning" class="status-line"><div><strong>Automatic repair incomplete</strong><div class="muted small">{{ warning }}</div></div><el-tag type="warning">Attention</el-tag></div>
                        <div v-for="check in doctor?.report?.checks" :key="`${check.label}-${check.detail}`" class="status-line"><div><strong>{{ friendlyCheck(check.label, check.detail).title }}</strong><div class="muted small">{{ friendlyCheck(check.label, check.detail).detail }}</div></div><el-tag :type="tagType(check.level)">{{ check.level === 'ok' ? 'OK' : check.level === 'warn' ? 'Attention' : 'Action needed' }}</el-tag></div>
                    </div>
                </el-tab-pane>
                <el-tab-pane label="Tools and skills" name="capabilities"><CapabilitiesPanel :setup="setup" :busy="busy" :save-capabilities="saveCapabilities" /></el-tab-pane>
                <el-tab-pane label="Runtime logs" name="logs">
                    <div class="section-heading"><div><h2>Runtime logs</h2><p>View live Runtime, project tool, and public connection logs.</p></div><div class="inline-actions"><el-input-number v-model="lines" :min="1" :max="5000" :controls="false" style="width: 100px" /><el-button :icon="Refresh" @click="startLogStream">Apply line count</el-button></div></div>
                    <el-alert v-if="logError" type="error" :closable="false" :title="logError" style="margin-bottom: 12px" />
                    <pre class="log-view">{{ logs }}</pre>
                </el-tab-pane>
                <el-tab-pane label="Software updates" name="update">
                    <div class="section-heading"><div><h2>Install latest version</h2><p>Updating briefly restarts MCP Runtime and the control panel. Project and connection settings are preserved.</p></div><el-button type="primary" :icon="Download" :disabled="busy" @click="emit('update')">Check and update</el-button></div>
                    <OperationPanel v-if="operation?.kind === 'update'" :operation="operation" @cancel="emit('cancelOperation', $event)" />
                </el-tab-pane>
            </el-tabs>
        </el-card>
    </div>
</template>
