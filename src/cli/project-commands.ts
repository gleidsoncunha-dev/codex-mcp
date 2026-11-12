import { isCancel, multiselect } from "@clack/prompts";
import { resolveProjectRoot } from "../config/loader.js";
import type { RegisteredProject } from "../daemon/state.js";
import {
    addProject,
    cleanupProjectConversations,
    getProject,
    listProjectConversations,
    listProjects,
    removeProject,
} from "../control/services.js";
import {
    printInfo,
    printIntro,
    printOutro,
    printSuccess,
    printSummary,
    printWarning,
} from "../lib/util/terminal.js";
import type { CliFlags } from "./args.js";
import { canPromptInteractively } from "../tunnel/prompt.js";

export async function runProjectCommand(flags: CliFlags): Promise<void> {
    await runProjectAction(flags);
}

export async function runBindingsCommand(flags: CliFlags): Promise<void> {
    if (flags.bindingsAction !== "clean") {
        throw new Error("The bindings command requires the clean subcommand");
    }
    if (!canPromptInteractively()) {
        throw new Error("Clearing session bindings requires an interactive terminal");
    }
    const target = flags.target ?? resolveProjectRoot(undefined);
    const current = await listProjectConversations(target);
    if (!current.project) throw new Error(`Project not found: ${target}`);

    printIntro("codex-mcp bindings clean");
    if (current.conversations.length === 0) {
        printInfo(`Project ${current.project.name} has no session bindings.`);
        printOutro("Nothing to clear");
        return;
    }

    const selected = await multiselect<string>({
        message: "Press Space to select sessions to clear; unselected sessions will be kept",
        options: current.conversations.map((conversation) => ({
            value: conversation.id,
            label: `${conversation.label} ${conversation.id.slice(0, 6)}`,
            hint: `Last used ${formatBindingTime(conversation.lastSeenAt)}`,
        })),
        initialValues: [],
        required: false,
    });
    if (isCancel(selected)) throw new Error("Session binding cleanup cancelled");
    if (selected.length === 0) {
        printInfo("No sessions selected. No changes made.");
        printOutro("Session bindings unchanged");
        return;
    }

    const result = await cleanupProjectConversations(target, selected);
    printSuccess(`Cleared ${result.removed} session bindings for project ${current.project.name}.`);
    printInfo(`Kept ${result.conversations.length} session bindings.`);
    printOutro("Session binding cleanup complete");
}

async function runProjectAction(flags: CliFlags): Promise<void> {
    const action = flags.projectAction ?? "list";
    if (action === "add") {
        const projectRoot = resolveProjectRoot(flags.target);
        const project = await addProject(projectRoot);
        printSuccess(`Registered project ${project.name} (${project.path}).`);
        printInfo(`Project ID: ${project.id}`);
        return;
    }

    if (action === "list") {
        printProjectList(await listProjects());
        return;
    }

    const target = flags.target ?? resolveProjectRoot(undefined);
    if (action === "info") {
        const project = await getProject(target);
        if (!project) throw new Error(flags.target ? `Project not found: ${flags.target}` : "The current directory is not registered as a project");
        printIntro("codex-mcp project info");
        printSummary("Project", [
            { label: "Name", value: project.name },
            { label: "ID", value: project.id },
            { label: "Directory", value: project.path },
            { label: "Status", value: project.active ? "Active" : "Inactive" },
            { label: "Session bindings", value: project.boundSessions == null ? "Runtime stopped" : String(project.boundSessions) },
            { label: "Last used", value: project.lastSeenAt },
        ]);
        printOutro("Project details");
        return;
    }

    const result = await removeProject(target);
    if (!result.removed) {
        printWarning(`Project ${result.project.name} is already inactive.`);
        return;
    }
    printSuccess(`Deactivated project ${result.project.name} (${result.project.path}).`);
}

function formatBindingTime(value: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return value;
    return new Intl.DateTimeFormat("en-US", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(timestamp);
}

function printProjectList(projects: Array<RegisteredProject & { boundSessions?: number | null }>): void {
    printIntro("codex-mcp project list");
    if (projects.length === 0) {
        printInfo("No projects registered. Run `codex-mcp project add [directory]` to add one.");
        printOutro("Project list");
        return;
    }
    for (const project of projects) {
        const sessions = project.boundSessions == null ? " · Runtime stopped" : ` · ${project.boundSessions} session bindings`;
        printInfo(`- ${project.name}${project.active ? "" : " (Inactive)"} · ${project.id} · ${project.path}${sessions}`);
    }
    printOutro(`${projects.length} projects`);
}
