import type { ToolName } from "../tools/names.js";

export const TOOL_LABELS: Record<ToolName, string> = {
    project_control: "Manage session project",
    read: "Read files",
    read_image: "Read image",
    apply_patch: "Apply patch",
    ls: "List directory",
    grep: "Search content",
    glob: "Find files",
    code_explore: "Explore code structure",
    exec_command: "Run command",
    write_stdin: "Terminal interaction",
    skills_list: "List skills",
    skill_read: "Read skill",
    mcp_tools: "Discover downstream tools",
    mcp_call: "Call downstream tool",
    summary: "Summarize this round",
};

export const TOOL_STATUS: Record<ToolName, { invoking: string; invoked: string }> = {
    project_control: { invoking: "Managing session project…", invoked: "Session project updated" },
    read: { invoking: "Reading files…", invoked: "Files read" },
    read_image: { invoking: "Reading image…", invoked: "Image read" },
    apply_patch: { invoking: "Applying patch…", invoked: "Patch applied" },
    ls: { invoking: "Listing directory…", invoked: "Directory listed" },
    grep: { invoking: "Searching content…", invoked: "Content search complete" },
    glob: { invoking: "Finding files…", invoked: "File search complete" },
    code_explore: { invoking: "Exploring code structure…", invoked: "Code exploration complete" },
    exec_command: { invoking: "Running command…", invoked: "Command complete" },
    write_stdin: { invoking: "Reading terminal…", invoked: "Terminal updated" },
    skills_list: { invoking: "Listing skills…", invoked: "Skills listed" },
    skill_read: { invoking: "Reading skill…", invoked: "Skill read" },
    mcp_tools: { invoking: "Discovering MCP tools…", invoked: "MCP tools loaded" },
    mcp_call: { invoking: "Calling MCP tool…", invoked: "MCP tool call complete" },
    summary: { invoking: "Preparing round summary…", invoked: "Round complete" },
};

export function toolLabel(toolName: string): string {
    return Object.prototype.hasOwnProperty.call(TOOL_LABELS, toolName)
        ? TOOL_LABELS[toolName as ToolName]
        : toolName;
}

export function toolStatus(toolName: string): { invoking: string; invoked: string } {
    return Object.prototype.hasOwnProperty.call(TOOL_STATUS, toolName)
        ? TOOL_STATUS[toolName as ToolName]
        : { invoking: "Calling tool…", invoked: "Call complete" };
}
