<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { FolderOpened, Folder, Select } from "@element-plus/icons-vue";
import { api, friendlyError, type ProjectSuggestion } from "../api.js";

const props = defineProps<{
    modelValue: boolean;
    busy: boolean;
    addProject: (path: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const path = ref("");
const suggestions = ref<ProjectSuggestion[]>([]);
const manual = ref(false);
const picking = ref(false);
const error = ref("");
let pickerController: AbortController | undefined;

watch(() => props.modelValue, (open) => {
    if (!open) return;
    path.value = "";
    error.value = "";
    manual.value = false;
    void api<{ suggestions: ProjectSuggestion[] }>("/api/project-suggestions")
        .then((data) => { suggestions.value = data.suggestions; })
        .catch(() => { suggestions.value = []; });
});

onBeforeUnmount(() => pickerController?.abort());

async function choose(): Promise<void> {
    picking.value = true;
    error.value = "";
    const controller = new AbortController();
    pickerController = controller;
    try {
        const result = await api<{ path?: string; unavailable?: boolean }>("/api/project-folder", { method: "POST", body: {}, signal: controller.signal });
        if (result.path) path.value = result.path;
        if (result.unavailable) {
            manual.value = true;
            error.value = "The system folder picker could not open. Choose a suggested project or enter its full path.";
        }
    } catch (reason) {
        if (!controller.signal.aborted) error.value = friendlyError(reason);
    } finally {
        picking.value = false;
    }
}

async function add(): Promise<void> {
    if (await props.addProject(path.value)) emit("update:modelValue", false);
}
function close(): void {
    pickerController?.abort();
    if (!props.busy) emit("update:modelValue", false);
}
</script>

<template>
    <el-dialog :model-value="modelValue" title="Add project" width="min(560px, 92vw)" :close-on-click-modal="!busy" @close="close">
        <p class="muted" style="margin-top: -8px">Choose a project folder on this computer so ChatGPT can work in it.</p>
        <el-button class="break-all" style="width: 100%; height: auto; min-height: 64px; margin-top: 16px" :loading="picking" :disabled="busy" @click="choose">
            <el-icon><FolderOpened /></el-icon>
            {{ picking ? "Choose a folder in the system dialog" : "Open system folder picker" }}
        </el-button>
        <el-alert v-if="path" style="margin-top: 14px" type="success" :closable="false"><template #title>Selected: {{ path }}</template></el-alert>
        <div v-if="suggestions.length" style="margin-top: 18px">
            <div class="muted small" style="margin-bottom: 6px">Recent or discovered projects</div>
            <el-scrollbar max-height="190px">
                <div v-for="item in suggestions" :key="item.path" class="status-line" style="cursor: pointer" @click="path = item.path; error = ''">
                    <div class="inline-actions" style="min-width: 0"><el-icon><Folder /></el-icon><div style="min-width: 0"><div>{{ item.name }}</div><div class="muted small break-all">{{ item.path }}</div></div></div>
                    <el-icon v-if="path === item.path" color="var(--el-color-success)"><Select /></el-icon>
                </div>
            </el-scrollbar>
        </div>
        <el-button text type="primary" style="margin-top: 12px" @click="manual = !manual">{{ manual ? "Hide manual entry" : "Enter path manually" }}</el-button>
        <el-input v-if="manual" v-model="path" placeholder="Full path to the project folder" />
        <el-alert v-if="error" style="margin-top: 12px" type="warning" :closable="false" :title="error" />
        <template #footer>
            <el-button :disabled="busy" @click="close">Cancel</el-button>
            <el-button type="primary" :loading="busy" :disabled="!path.trim() || picking" @click="add">Add project</el-button>
        </template>
    </el-dialog>
</template>
