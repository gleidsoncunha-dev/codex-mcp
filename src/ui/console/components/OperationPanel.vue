<script setup lang="ts">
import { computed } from "vue";
import { CircleCheck, Loading, WarningFilled, CircleClose } from "@element-plus/icons-vue";
import { friendlyError, type OperationSnapshot } from "../api.js";

const props = defineProps<{ operation?: OperationSnapshot }>();
const emit = defineEmits<{ cancel: [id: string] }>();

const presentation = computed(() => {
    const state = props.operation?.state;
    if (state === "succeeded") return { type: "success" as const, label: "Completed", icon: CircleCheck };
    if (state === "cancelled") return { type: "warning" as const, label: "Cancelled", icon: WarningFilled };
    if (state === "failed") return { type: "danger" as const, label: "Incomplete", icon: CircleClose };
    return { type: "info" as const, label: "Processing", icon: Loading };
});

function friendlyPhase(message: string): string {
    const exact: Record<string, string> = {
        "Preparing": "Preparing operation",
        "Run diagnostics": "Checking service",
        "Run safe local repairs": "Fixing common issues",
        "Verify public connection": "Checking public connection",
        "Open Cloudflare login": "Opening Cloudflare login",
        "Read Cloudflare login": "Reading Cloudflare account",
        "Cloudflare domains loaded": "Available domains loaded",
        "Cancelling": "Cancelling",
        "Done": "Operation complete",
    };
    return exact[message] ?? message;
}
</script>

<template>
    <el-card v-if="operation" class="operation-panel" shadow="never">
        <div class="section-heading" style="margin-bottom: 0">
            <div>
                <div class="inline-actions">
                    <el-icon :class="{ 'is-loading': operation.state === 'running' }"><component :is="presentation.icon" /></el-icon>
                    <strong>{{ friendlyPhase(operation.phase) }}</strong>
                    <el-tag :type="presentation.type" effect="light">{{ presentation.label }}</el-tag>
                </div>
                <div v-if="operation.messages.length" class="operation-messages">
                    <div v-for="(message, index) in operation.messages.slice(-8)" :key="`${index}-${message}`">{{ friendlyPhase(message) }}</div>
                </div>
                <el-alert v-if="operation.error" class="operation-panel" type="error" :closable="false" :title="friendlyError(operation.error)" />
            </div>
            <el-button v-if="operation.state === 'running'" text @click="emit('cancel', operation.id)">Cancel</el-button>
        </div>
    </el-card>
</template>
