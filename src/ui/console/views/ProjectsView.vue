<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FolderAdd, ChatDotRound, Delete } from "@element-plus/icons-vue";
import type { Conversation, Project } from "../api.js";

const props = defineProps<{ projects: Project[]; conversations: Conversation[]; busy: boolean }>();
const emit = defineEmits<{
    add: [];
    reactivate: [project: Project];
    remove: [project: Project];
    cleanup: [project: Project, ids: string[]];
}>();

const drawerOpen = ref(false);
const drawerProject = ref<Project>();
const activeConversations = computed(() => drawerProject.value ? props.conversations.filter((item) => item.projectId === drawerProject.value!.id) : []);
function conversationCount(project: Project): number { return props.conversations.filter((item) => item.projectId === project.id).length; }
function openProject(project: Project): void { drawerProject.value = project; drawerOpen.value = true; }
watch(() => props.projects, (items) => {
    if (!drawerProject.value) return;
    const current = items.find((item) => item.id === drawerProject.value?.id);
    if (!current) { drawerOpen.value = false; drawerProject.value = undefined; return; }
    drawerProject.value = current;
}, { deep: true });
</script>

<template>
    <div>
        <div class="page-heading">
            <div class="section-heading" style="margin-bottom: 0">
                <div><h1>Projects</h1><p>Manage projects accessible to ChatGPT and their session bindings.</p></div>
                <el-button type="primary" :icon="FolderAdd" @click="emit('add')">Add project</el-button>
            </div>
        </div>

        <el-card shadow="never">
            <el-empty v-if="!projects.length" description="No projects yet"><el-button type="primary" @click="emit('add')">Choose project folder</el-button></el-empty>
            <el-table v-else :data="projects" style="width: 100%" @row-click="openProject">
                <el-table-column label="Project" min-width="280">
                    <template #default="{ row }"><div class="project-name">{{ row.name }}</div><div class="project-path">{{ row.path }}</div></template>
                </el-table-column>
                <el-table-column label="Status" width="110"><template #default="{ row }"><el-tag :type="row.active ? 'success' : 'info'" effect="light">{{ row.active ? "Available" : "Inactive" }}</el-tag></template></el-table-column>
                <el-table-column label="Sessions" width="110"><template #default="{ row }">{{ conversationCount(row) }}</template></el-table-column>
                <el-table-column label="Action" width="180" align="right">
                    <template #default="{ row }"><el-button text type="primary" @click.stop="openProject(row)">Manage</el-button><el-button v-if="row.active" text type="danger" :disabled="busy" @click.stop="emit('remove', row)">Deactivate</el-button><el-button v-else text type="primary" :disabled="busy" @click.stop="emit('reactivate', row)">Reactivate</el-button></template>
                </el-table-column>
            </el-table>
        </el-card>
        <p v-if="conversations.length" class="muted small" style="margin-top: 12px">Session IDs distinguish project selection records. They do not indicate an active ChatGPT conversation.</p>

        <el-drawer v-model="drawerOpen" :title="drawerProject?.name ?? 'Project details'" size="min(520px, 92vw)">
            <template v-if="drawerProject">
                <el-descriptions :column="1" border>
                    <el-descriptions-item label="Status"><el-tag :type="drawerProject.active ? 'success' : 'info'">{{ drawerProject.active ? "Available" : "Inactive" }}</el-tag></el-descriptions-item>
                    <el-descriptions-item label="Directory"><span class="break-all mono small">{{ drawerProject.path }}</span></el-descriptions-item>
                    <el-descriptions-item label="Project ID"><span class="mono small">{{ drawerProject.id }}</span></el-descriptions-item>
                </el-descriptions>
                <div class="section-heading" style="margin-top: 24px">
                    <div><h2>Session bindings</h2><p>After clearing, this ChatGPT session must select a project again when it next uses project tools.</p></div>
                    <el-button v-if="activeConversations.length > 1" text type="danger" :disabled="busy" @click="emit('cleanup', drawerProject, activeConversations.map((item) => item.id))">Clear all</el-button>
                </div>
                <el-empty v-if="!activeConversations.length" :image-size="60" description="No sessions have selected this project yet" />
                <div v-for="item in activeConversations" v-else :key="item.id" class="conversation-row">
                    <el-icon><ChatDotRound /></el-icon>
                    <div class="conversation-meta"><div>{{ item.label }} · {{ item.id.slice(0, 8) }}</div><div class="muted small">Last used {{ new Date(item.lastSeenAt).toLocaleString("en-US") }}</div></div>
                    <el-button text type="danger" :icon="Delete" :disabled="busy" @click="emit('cleanup', drawerProject, [item.id])">Clear</el-button>
                </div>
                <el-button v-if="drawerProject.active" style="margin-top: 24px" type="danger" plain :disabled="busy" @click="emit('remove', drawerProject)">Deactivate this project</el-button>
                <el-button v-else style="margin-top: 24px" type="primary" :disabled="busy" @click="emit('reactivate', drawerProject)">Reactivate this project</el-button>
            </template>
        </el-drawer>
    </div>
</template>
