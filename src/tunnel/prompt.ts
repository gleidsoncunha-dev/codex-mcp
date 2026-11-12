import {
    confirm,
    isCancel,
    password,
    select,
    spinner,
    text,
} from "@clack/prompts";
import { stdin as input, stdout as output } from "node:process";

/**
 * Whether stdin/stdout can drive an interactive wizard.
 *
 * @returns True when both are TTYs
 */
export function canPromptInteractively(): boolean {
    return input.isTTY === true && output.isTTY === true;
}

/**
 * Ask a yes/no question.
 *
 * @param question - Prompt text
 * @param defaultYes - Initially selected answer
 * @returns True for yes
 */
export async function askYesNo(
    question: string,
    defaultYes = true,
): Promise<boolean> {
    requireInteractiveTerminal();
    return promptValue(
        await confirm({
            message: question,
            initialValue: defaultYes,
            active: "Yes",
            inactive: "No",
        }),
    );
}

/**
 * Ask for a single line of input.
 *
 * @param question - Prompt text
 * @param defaultValue - Value when the user submits an empty input
 * @returns Trimmed answer (or default)
 */
export async function askLine(
    question: string,
    defaultValue?: string,
): Promise<string> {
    requireInteractiveTerminal();
    return promptValue(
        await text({
            message: question,
            ...(defaultValue !== undefined
                ? { placeholder: defaultValue, defaultValue }
                : {}),
        }),
    ).trim();
}

/**
 * Ask the user to choose one value from a terminal menu.
 *
 * @param question - Prompt text
 * @param options - Selectable string values
 * @param initialValue - Initially selected value
 * @returns Selected value
 */
export async function askSelect(
    question: string,
    options: Array<{ value: string; label?: string; hint?: string }>,
    initialValue?: string,
): Promise<string> {
    requireInteractiveTerminal();
    if (options.length === 0) {
        throw new Error("Selection list must not be empty");
    }
    return promptValue(
        await select({
            message: question,
            options,
            ...(initialValue !== undefined ? { initialValue } : {}),
        }),
    );
}

/**
 * Read a secret from an interactive TTY without echoing it.
 *
 * @param question - Prompt text
 * @returns Secret text without the trailing newline
 */
export async function askSecret(question: string): Promise<string> {
    requireInteractiveTerminal();
    return promptValue(await password({ message: question }));
}

/** Run one setup operation with a Clack spinner and a deterministic terminal outcome. */
export async function withSpinner<T>(
    message: string,
    successMessage: string,
    action: () => Promise<T>,
): Promise<T> {
    if (!canPromptInteractively()) return await action();
    const progress = spinner();
    progress.start(message);
    try {
        const result = await action();
        progress.stop(successMessage);
        return result;
    } catch (error) {
        progress.stop("Operation failed");
        throw error;
    }
}

function requireInteractiveTerminal(): void {
    if (!canPromptInteractively()) {
        throw new Error("This requires an interactive terminal");
    }
}

function promptValue<T>(value: T | symbol): T {
    if (isCancel(value)) {
        throw new Error("Input cancelled");
    }
    return value;
}
