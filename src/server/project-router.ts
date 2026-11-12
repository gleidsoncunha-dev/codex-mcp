import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ProjectContext } from "../config/project.js";
import { CurrentOwnerProcessSessions } from "../lib/process/current-owner.js";
import type { ProcessSessionAccess } from "../lib/process/sessions.js";
import type { RoundChangeTracker } from "../lib/tool/round-changes.js";
import { currentToolOwnerId } from "../lib/tool/context.js";
import { errorResult } from "../lib/tool/result.js";
import type { RegisteredProject } from "../daemon/state.js";
import type { BindingStore } from "../projects/bindings.js";
import type { ProjectRegistry } from "../projects/registry.js";
import type { ProjectRuntimeManager, ProjectRuntime } from "../projects/runtime.js";
import { writeRuntimeLog } from "../lib/runtime-log.js";

/**
 * Everything a project-level tool needs for one tool call. Resolved at call
 * time from the conversation binding, never captured at registration time.
 */
export interface ToolProjectScope {
    readonly project: ProjectContext;
    readonly processes: ProcessSessionAccess;
    readonly roundChanges: RoundChangeTracker;
}

/**
 * Resolve the scope for the current tool call. Throws UnboundProjectError when
 * the current conversation has no valid binding (fail closed).
 */
export type ToolScopeProvider = () => ToolProjectScope;

/** Read-only variant that returns undefined instead of throwing when unbound. */
export type ToolScopeTryProvider = () => ToolProjectScope | undefined;

/**
 * Thrown (and caught by tool handlers) when a project-level tool runs in a
 * conversation that has not bound a project, or whose bound project is gone.
 */
export class UnboundProjectError extends Error {
    constructor(
        message: string,
        readonly projects: RegisteredProject[] = [],
    ) {
        super(message);
        this.name = "UnboundProjectError";
    }
}

/**
 * Conversation owner key used for project bindings. Reuse the same namespaced
 * owner identity as permissions and managed processes so an identical host
 * session id cannot cross OAuth/local client boundaries.
 */
export function currentBindingOwnerKey(fallbackOwnerId: string): string {
    return currentToolOwnerId(fallbackOwnerId);
}

/** Guidance text shown to ChatGPT when a project-level tool is called unbound. */
export function unboundProjectMessage(activeProjects: RegisteredProject[]): string {
    if (activeProjects.length === 0) {
        return [
            "This session has no project binding and no projects are registered. Ask the user to run codex-mcp start in a project directory first.",
            "After registration, call project_control(action=select, project_id=...).",
            "If project_control is absent from the approved ChatGPT action snapshot, refresh or republish MCP app actions.",
        ].join("\n");
    }
    const list = activeProjects
        .map((item) => `- ${item.id} (${item.name})${item.path}`)
        .join("\n");
    return [
        "This session has no project binding, so it cannot read or write files, run commands, or inspect Git status.",
        "Ask the user which project to use before continuing: ",
        list,
        "Call project_control(action=select, project_id=\"<confirmed project ID>\").",
        "If project_control is not visible, refresh or republish MCP app actions; removed legacy project tools have no compatibility entry points.",
    ].join("\n");
}

/**
 * Tool-catch helper: renders an UnboundProjectError as a structured error
 * result (so ChatGPT can parse the project list), and any other error as the
 * ordinary plain error result.
 */
export function projectErrorResult(error: unknown): CallToolResult {
    if (error instanceof UnboundProjectError) {
        return {
            isError: true,
            content: [{ type: "text", text: error.message }],
        };
    }
    return errorResult(error instanceof Error ? error.message : String(error));
}

/**
 * Call-time project scope resolver backed by the binding store and the lazy
 * runtime manager. Created per MCP request because the fallback owner id is
 * per-request (OAuth client or `local:noauth`).
 */
export class BindingProjectScopeProvider {
    constructor(
        private readonly registry: ProjectRegistry,
        private readonly bindings: BindingStore,
        private readonly runtimes: ProjectRuntimeManager,
        private readonly fallbackOwnerId: string,
    ) {}

    resolveRuntime(): ProjectRuntime {
        const ownerKey = currentBindingOwnerKey(this.fallbackOwnerId);
        const binding = this.bindings.resolve(ownerKey);
        const project = binding ? this.registry.getActiveById(binding.projectId) : undefined;

        // A stale or deactivated binding must fail closed, never route anywhere.
        if (binding && !project) {
            void this.bindings.unbind(ownerKey).catch((error: unknown) => {
                writeRuntimeLog("error", "stale_binding_cleanup_failed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }
        if (!project) {
            const activeProjects = this.registry.listActive();
            throw new UnboundProjectError(
                unboundProjectMessage(activeProjects),
                activeProjects,
            );
        }

        let runtime: ProjectRuntime;
        try {
            runtime = this.runtimes.get(project.id, project.path);
        } catch (error) {
            const activeProjects = this.registry.listActive();
            const detail = error instanceof Error ? error.message : String(error);
            throw new UnboundProjectError(
                [
                    `The bound project is unavailable (${detail}). Ask the user to register it again with codex-mcp start or explicitly select another project.`,
                    unboundProjectMessage(activeProjects),
                ].join("\n"),
                activeProjects,
            );
        }
        void this.bindings.touch(ownerKey).catch((error: unknown) => {
            writeRuntimeLog("error", "binding_touch_failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        });
        return runtime;
    }

    resolveProject(): ToolProjectScope {
        const ownerKey = currentBindingOwnerKey(this.fallbackOwnerId);
        const runtime = this.resolveRuntime();
        return {
            project: runtime.project,
            processes: new CurrentOwnerProcessSessions(
                runtime.rootProcesses,
                runtime.processOwners,
                this.fallbackOwnerId,
            ),
            roundChanges: runtime.roundChanges.forOwner(ownerKey),
        };
    }

    /** Read-only runtime view: undefined instead of throwing when unbound. */
    tryResolveRuntime(): ProjectRuntime | undefined {
        try {
            return this.resolveRuntime();
        } catch (error) {
            if (error instanceof UnboundProjectError) return undefined;
            throw error;
        }
    }

    /** Read-only project view: undefined instead of throwing when unbound. */
    tryResolveProject(): ToolProjectScope | undefined {
        try {
            return this.resolveProject();
        } catch (error) {
            if (error instanceof UnboundProjectError) return undefined;
            throw error;
        }
    }
}
