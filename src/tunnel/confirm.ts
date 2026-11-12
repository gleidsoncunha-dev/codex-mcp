import { askYesNo } from "./prompt.js";

export type ConfirmAction = (
    question: string,
    defaultValue?: boolean,
) => Promise<boolean>;

export async function requireDnsOverwriteConfirmation(
    domain: string,
    confirm: ConfirmAction = askYesNo,
): Promise<void> {
    const approved = await confirm(
        `Replace existing DNS records for ${domain} with this Tunnel? This changes where the domain points.`,
        false,
    );
    if (!approved) {
        throw new Error("Cancelled. Existing DNS records unchanged");
    }
}
