import { resolve } from "node:path";
import { CapabilityManager } from "./manager.js";
import { resolveCapabilitiesConfig } from "./config.js";
import type { CapabilitySourceDetection } from "./provider.js";
import {
    loadUserConfig,
    saveUserConfig,
    type CapabilitySourceConfig,
    type CapabilitySourceId,
    type UserCapabilitiesConfig,
} from "../config/user-config.js";
import { printInfo, printSummary } from "../lib/util/terminal.js";
import { askSelect } from "../tunnel/prompt.js";

const SOURCE_PRIORITY: CapabilitySourceId[] = ["agents", "codex", "claude"];

export interface CapabilitySetupResult {
    detections: CapabilitySourceDetection[];
    config?: UserCapabilitiesConfig;
    changed: boolean;
}

export async function configureCapabilitySources(
    primaryWorkspace = process.cwd(),
): Promise<CapabilitySetupResult> {
    const manager = new CapabilityManager(resolve(primaryWorkspace));
    const detections = await manager.detectSources();
    const detected = detections.filter((item) => item.detected);
    const currentConfig = loadUserConfig().capabilities;

    printSummary(
        "External capabilities",
        detections.map((item) => ({
            label: item.label,
            value: item.detected
                ? describeDetection(item)
                : "Not detected",
        })),
    );

    if (detected.length === 0) {
        printInfo("No Codex, Claude Code, or Agent Skills detected. Keeping defaults without writing extra configuration.");
        return { detections, changed: false };
    }

    const action = await askSelect(
        "Allow codex-mcp to use these existing capabilities?",
        [
            { value: "all", label: "Use all detected capabilities", hint: "Recommended; read source configuration without copying" },
            { value: "custom", label: "Custom", hint: "Choose MCP and skills separately" },
            { value: "off", label: "Use none" },
            { value: "keep", label: "Keep current settings" },
        ],
        "all",
    );

    if (action === "keep") return { detections, changed: false };

    const sources: Partial<Record<CapabilitySourceId, CapabilitySourceConfig>> = {
        ...(currentConfig?.sources ?? {}),
    };
    if (action === "all") {
        for (const item of detected) {
            sources[item.source] = detectedSourceDefaults(item);
        }
    } else if (action === "off") {
        for (const source of SOURCE_PRIORITY) {
            sources[source] = sourceDefaults(source, false);
        }
    } else {
        for (const item of detected) {
            sources[item.source] = await configureOneSource(item.source, item.label);
        }
    }

    // Detection only describes this machine/current workspace. Not seeing a source
    // here must not silently disable a source the user enabled for another project.
    const resolvedNext = resolveCapabilitiesConfig({
        ...currentConfig,
        sources,
    });
    const anyEnabled = SOURCE_PRIORITY.some((source) => resolvedNext.sources[source].enabled);
    const sync = anyEnabled
        ? await askSelect(
              "How should external capability changes be synced?",
              [
                  { value: "watch", label: "Sync changes automatically", hint: "Recommended; refresh when source configuration changes" },
                  { value: "startup", label: "Read only at startup", hint: "Do not watch files while running" },
              ],
              "watch",
          )
        : "startup";

    const config: UserCapabilitiesConfig = {
        sync: sync as "watch" | "startup",
        priority: currentConfig?.priority ?? [...SOURCE_PRIORITY],
        sources,
    };
    saveUserConfig({ capabilities: config });
    return { detections, config, changed: true };
}

export function describeCapabilitiesConfig(config?: UserCapabilitiesConfig): string {
    const resolved = resolveCapabilitiesConfig(config);
    const enabled = resolved.priority
        .filter((source) => resolved.sources[source].enabled)
        .map(sourceLabel);
    const sync = resolved.sync === "startup" ? "Read at startup" : "Automatic sync";
    return `${enabled.length > 0 ? enabled.join(" + ") : "External capabilities disabled"} · ${sync}`;
}

function detectedSourceDefaults(item: CapabilitySourceDetection): CapabilitySourceConfig {
    if (!item.detected) return sourceDefaults(item.source, false);
    if (item.source === "agents") return { enabled: true, mcp: false, skills: true };
    if (item.source === "codex") {
        return {
            enabled: true,
            mcp: item.mcp,
            skills: item.skills || item.mcp,
        };
    }
    return { enabled: true, mcp: true, skills: true };
}

function sourceDefaults(source: CapabilitySourceId, enabled: boolean): CapabilitySourceConfig {
    return {
        enabled,
        mcp: enabled && source !== "agents",
        skills: enabled,
    };
}

async function configureOneSource(
    source: CapabilitySourceId,
    label: string,
): Promise<CapabilitySourceConfig> {
    if (source === "agents") {
        const choice = await askSelect(
            `${label}: `,
            [
                { value: "skills", label: "Use skills" },
                { value: "off", label: "Do not use" },
            ],
            "skills",
        );
        return sourceDefaults(source, choice !== "off");
    }

    const choice = await askSelect(
        `${label}: `,
        [
            { value: "all", label: "Use MCP and skills" },
            { value: "mcp", label: "Use MCP only" },
            { value: "skills", label: "Use skills only" },
            { value: "off", label: "Do not use" },
        ],
        "all",
    );
    return {
        enabled: choice !== "off",
        mcp: choice === "all" || choice === "mcp",
        skills: choice === "all" || choice === "skills",
    };
}

function describeDetection(item: CapabilitySourceDetection): string {
    const parts: string[] = [];
    if (item.mcp) parts.push("MCP");
    if (item.skills) parts.push("Skills");
    if (parts.length === 0 && item.detail) parts.push(item.detail);
    return parts.length > 0 ? `Detected · ${parts.join(" + ")}` : "Detected";
}

function sourceLabel(source: CapabilitySourceId): string {
    if (source === "agents") return "Agent Skills";
    if (source === "claude") return "Claude Code";
    return "Codex";
}
