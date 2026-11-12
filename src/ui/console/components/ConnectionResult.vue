<script setup lang="ts">
import { CircleCheck, WarningFilled, Clock } from "@element-plus/icons-vue";
import type { ConnectionCheck } from "../api.js";

defineProps<{ result?: ConnectionCheck }>();
const emit = defineEmits<{ action: [value: "start" | "connect" | "projects" | "repair"] }>();

function iconFor(state: ConnectionCheck["checks"][number]["state"]) {
    return state === "passed" ? CircleCheck : state === "failed" ? WarningFilled : Clock;
}
function colorFor(state: ConnectionCheck["checks"][number]["state"]): string {
    return state === "passed" ? "var(--el-color-success)" : "var(--el-color-warning)";
}
</script>

<template>
    <el-card v-if="result" shadow="never">
        <div class="section-heading">
            <div>
                <h2>{{ result.ready ? "Connection check passed" : "Some checks need attention" }}</h2>
                <p>{{ result.ready ? "The service is ready. You can use this MCP connection in ChatGPT." : "Follow the steps below, then check again." }}</p>
            </div>
            <el-tag :type="result.ready ? 'success' : 'warning'">{{ result.ready ? "Ready" : "Not ready" }}</el-tag>
        </div>
        <div v-for="item in result.checks" :key="item.id" class="status-line">
            <div class="inline-actions" style="align-items: flex-start">
                <el-icon :style="{ color: colorFor(item.state), marginTop: '2px' }"><component :is="iconFor(item.state)" /></el-icon>
                <div><strong>{{ item.label }}</strong><div class="muted small" style="margin-top: 4px">{{ item.detail }}</div></div>
            </div>
            <el-button v-if="item.action" text type="primary" @click="emit('action', item.action)">Resolve</el-button>
        </div>
        <div class="muted small" style="margin-top: 12px">Checked at {{ new Date(result.checkedAt).toLocaleTimeString("en-US") }}</div>
    </el-card>
</template>
