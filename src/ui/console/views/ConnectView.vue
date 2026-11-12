<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Connection, CopyDocument, Key, MagicStick, Refresh } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus/es/components/message/index";
import "element-plus/es/components/message/style/css";
import type { ConnectionCheck, OperationSnapshot, SetupSummary } from "../api.js";
import ConnectionResult from "../components/ConnectionResult.vue";
import OperationPanel from "../components/OperationPanel.vue";

const props = defineProps<{
    setup?: SetupSummary;
    result?: ConnectionCheck;
    operation?: OperationSnapshot;
    zones: string[];
    busy: boolean;
    savePassword: (password: string) => Promise<void>;
    generatePassword: () => Promise<string | undefined>;
}>();
const emit = defineEmits<{
    check: [];
    discover: [];
    applyCloudflare: [zone: string, prefix: string, overwrite: boolean];
    applyExternal: [domain: string];
    cancelOperation: [id: string];
    resultAction: [action: "start" | "connect" | "projects" | "repair"];
}>();

const cloudflareOpen = ref(false);
const externalOpen = ref(false);
const passwordOpen = ref(false);
const zone = ref("");
const prefix = ref("codex-mcp");
const overwrite = ref(false);
const externalDomain = ref("");
const password = ref("");
const generatedPassword = ref("");

const access = computed(() => props.setup?.config.publicAccess);
const publicUrl = computed(() => access.value ? `https://${access.value.domain}/mcp` : "");

watch(() => props.zones, (values) => { if (values.length && !values.includes(zone.value)) zone.value = values[0] ?? ""; }, { immediate: true });

async function copy(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); ElMessage.success("Copied to clipboard"); }
    catch { ElMessage.error("Copy failed. Please copy manually."); }
}
async function saveConnectionPassword(): Promise<void> {
    await props.savePassword(password.value);
    password.value = "";
    passwordOpen.value = false;
}
async function generate(): Promise<void> {
    const value = await props.generatePassword();
    if (value) generatedPassword.value = value;
}
</script>

<template>
    <div>
        <div class="page-heading"><h1>Connect ChatGPT</h1><p>Set up a public address and connection password, then run a connection check.</p></div>

        <div class="stack">
            <el-card shadow="never">
                <div class="section-heading">
                    <div><h2>1. Public address</h2><p>{{ access ? "The connection address is ready." : "Use automatic Cloudflare setup or enter an existing HTTPS domain." }}</p></div>
                    <el-tag :type="access ? 'success' : 'warning'">{{ access ? "Configured" : "Not configured" }}</el-tag>
                </div>
                <div v-if="publicUrl" class="copy-box"><el-icon><Connection /></el-icon><code>{{ publicUrl }}</code><el-button text :icon="CopyDocument" @click="copy(publicUrl)" /></div>
                <div class="inline-actions" style="margin-top: 16px">
                    <el-button type="primary" :icon="MagicStick" @click="cloudflareOpen = true">Automatic Cloudflare setup</el-button>
                    <el-button @click="externalOpen = true">Use your own domain</el-button>
                </div>
                <OperationPanel :operation="operation" @cancel="emit('cancelOperation', $event)" />
            </el-card>

            <el-card shadow="never">
                <div class="section-heading"><div><h2>2. Connection password</h2><p>Public MCP requests require a password. Web Console is always local only.</p></div><el-tag :type="setup?.passwordConfigured ? 'success' : 'warning'">{{ setup?.passwordConfigured ? "Set" : "Not set" }}</el-tag></div>
                <div class="inline-actions"><el-button :icon="Key" @click="passwordOpen = true">{{ setup?.passwordConfigured ? "Change password" : "Set password" }}</el-button><el-button text @click="generate">Generate and set secure password</el-button></div>
                <el-alert v-if="generatedPassword" style="margin-top: 14px" type="warning" :closable="false"><template #title>Password set. Save it now.</template><div class="copy-box" style="margin-top: 8px"><code>{{ generatedPassword }}</code><el-button text :icon="CopyDocument" @click="copy(generatedPassword)" /></div></el-alert>
            </el-card>

            <el-card shadow="never">
                <div class="section-heading"><div><h2>3. Check connection</h2><p>Check that the public address, password, Runtime, and projects are ready.</p></div><el-button type="primary" :icon="Refresh" :loading="busy" @click="emit('check')">Run checks</el-button></div>
                <div v-if="!result" class="muted small">If a check fails, you will see the next step to resolve it.</div>
            </el-card>

            <ConnectionResult :result="result" @action="emit('resultAction', $event)" />
        </div>

        <el-dialog v-model="cloudflareOpen" title="Automatic Cloudflare setup" width="min(520px, 92vw)">
            <template v-if="zones.length">
                <el-form label-position="top">
                    <el-form-item label="Domain"><el-select v-model="zone" style="width: 100%"><el-option v-for="item in zones" :key="item" :label="item" :value="item" /></el-select></el-form-item>
                    <el-form-item label="Subdomain prefix"><el-input v-model="prefix" /><div class="muted small" style="margin-top: 6px">Final address: {{ prefix || 'codex-mcp' }}.{{ zone || 'example.com' }}</div></el-form-item>
                    <el-form-item><el-checkbox v-model="overwrite">Allow replacement of an existing DNS record</el-checkbox></el-form-item>
                </el-form>
            </template>
            <el-empty v-else description="Load available domains from your Cloudflare account. If needed, the authorization page opens automatically."><el-button type="primary" :loading="busy" @click="emit('discover')">Load available domains</el-button></el-empty>
            <template #footer><el-button @click="cloudflareOpen = false">Cancel</el-button><el-button v-if="zones.length" type="primary" :disabled="!zone || !prefix.trim() || busy" @click="cloudflareOpen = false; emit('applyCloudflare', zone, prefix, overwrite)">Start setup</el-button></template>
        </el-dialog>

        <el-dialog v-model="externalOpen" title="Use your own domain" width="min(500px, 92vw)">
            <el-form label-position="top"><el-form-item label="HTTPS domain"><el-input v-model="externalDomain" placeholder="mcp.example.com" /><div class="muted small" style="margin-top: 6px">Enter only the domain, without https:// or /mcp.</div></el-form-item></el-form>
            <template #footer><el-button @click="externalOpen = false">Cancel</el-button><el-button type="primary" :disabled="!externalDomain.trim() || busy" @click="externalOpen = false; emit('applyExternal', externalDomain)">Save and check</el-button></template>
        </el-dialog>

        <el-dialog v-model="passwordOpen" :title="setup?.passwordConfigured ? 'Change connection password' : 'Set connection password'" width="min(500px, 92vw)">
            <el-form label-position="top"><el-form-item label="New password"><el-input v-model="password" type="password" show-password autocomplete="new-password" placeholder="At least 12 characters" /></el-form-item></el-form>
            <template #footer><el-button @click="passwordOpen = false">Cancel</el-button><el-button type="primary" :loading="busy" :disabled="password.length < 12" @click="saveConnectionPassword">Save password</el-button></template>
        </el-dialog>
    </div>
</template>
