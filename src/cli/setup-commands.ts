import {
    generateAdminPassword,
    hasAdminPassword,
} from "../auth/password-store.js";
import { setConnectionPassword } from "../control/services.js";
import {
    configureCapabilitySources,
    describeCapabilitiesConfig,
} from "../capabilities/setup.js";
import { loadUserConfig } from "../config/user-config.js";
import {
    printInfo,
    printIntro,
    printNote,
    printOutro,
    printSuccess,
    printSummary,
    printWarning,
} from "../lib/util/terminal.js";
import {
    checkPublicAccess,
    configurePublicAccess,
} from "../tunnel/public-access-manager.js";
import { askSecret, askSelect, canPromptInteractively, withSpinner } from "../tunnel/prompt.js";
import {
    isPublicSetupConfigured,
    type AppliedTunnelSetup,
    type TunnelSetupResult,
} from "../tunnel/setup.js";

/** Run first-time setup or manage an already configured installation. */
export async function runFirstTimeSetup(): Promise<void> {
    if (!canPromptInteractively()) {
        throw new Error("First-time setup requires an interactive terminal");
    }

    const current = loadUserConfig();
    const passwordConfigured = await hasAdminPassword();
    if (isPublicSetupConfigured(current)) {
        await runSetupManager(current, passwordConfigured);
        return;
    }

    printIntro("Set up codex-mcp");
    printInfo("Set up and verify public access, then generate a ChatGPT connection password. External capabilities are optional.");

    const { result, verification } = await configurePublicAccess({ forceWizard: false });
    const generatedPassword = await ensureGeneratedAdminPassword({ display: false });
    try {
        await configureCapabilitySources();
    } catch (error) {
        printWarning(`Core connection setup is complete; external capability settings are unchanged: ${readableError(error)}`);
    }
    printCompletedSetup(result, verification, generatedPassword);
}

async function runSetupManager(
    current: ReturnType<typeof loadUserConfig>,
    passwordConfigured: boolean,
): Promise<void> {
    const access = current.publicAccess;
    if (!access) throw new Error("Public access has not been configured");
    printIntro("codex-mcp setup");
    printSummary("Current configuration", [
        { label: "Public address", value: `https://${access.domain}/mcp` },
        {
            label: "Public access method",
            value: access.kind === "external" ? "Custom HTTPS" : "Cloudflare Tunnel",
        },
        ...(access.kind === "cloudflare" ? [{ label: "Tunnel", value: access.tunnelName }] : []),
        { label: "Connection password", value: passwordConfigured ? "Set" : "Not set" },
        { label: "External capabilities", value: describeCapabilitiesConfig(current.capabilities) },
    ]);

    const action = await askSelect(
        "Choose an action",
        [
            { value: "check", label: "Check current configuration", hint: "Verify that the public address reaches this computer" },
            { value: "public", label: "Change public access", hint: "Choose a different domain or Cloudflare configuration" },
            ...(access.kind === "external"
                ? []
                : [
                      {
                          value: "cloudflare",
                          label: "Log in again or switch Cloudflare account",
                          hint: "Reset only the private codex-mcp login, leaving system ~/.cloudflared unchanged",
                      },
                  ]),
            {
                value: "password",
                label: passwordConfigured ? "Change connection password" : "Generate connection password",
                hint: passwordConfigured ? undefined : "Set the password required to connect ChatGPT",
            },
            { value: "capabilities", label: "Manage external capabilities", hint: "Codex / Claude Code / Agent Skills" },
            { value: "exit", label: "Exit without changes" },
        ],
        passwordConfigured ? "check" : "password",
    );

    if (action === "exit") {
        printOutro("Configuration unchanged");
        return;
    }
    if (action === "password") {
        if (passwordConfigured) {
            await configureAdminPassword();
        } else {
            await ensureGeneratedAdminPassword();
        }
        return;
    }
    if (action === "capabilities") {
        const result = await configureCapabilitySources();
        printOutro(result.changed ? "External capability settings saved" : "External capability settings unchanged");
        return;
    }

    if (action === "check") {
        const verification = await withSpinner(
            "Checking current public access (read-only)…",
            "Public connection check passed",
            () => checkPublicAccess(),
        );
        printSummary("Checks complete", [
            { label: "Public address", value: verification.publicMcpUrl },
            { label: "Status", value: "Confirmed that the address reaches this codex-mcp instance" },
        ]);
        printOutro("Configuration unchanged");
        return;
    }

    const { result, verification } = await configurePublicAccess({
        forceWizard: true,
        forceCloudflareLogin: action === "cloudflare",
    });
    printCompletedSetup(result, verification);
}

function printCompletedSetup(
    result: TunnelSetupResult,
    verification: AppliedTunnelSetup["verification"],
    generatedPassword?: string,
): void {
    const tunnelBits = [verification.tunnel?.protocol, verification.tunnel?.location].filter(
        (value): value is string => Boolean(value),
    );
    const rows = [
        { label: "Public address", value: verification.publicMcpUrl },
        {
            label: "Public connection",
            value: tunnelBits.length > 0 ? `Verified · ${tunnelBits.join(" · ")}` : "Verified",
        },
    ];
    if (result.publicAccess.kind === "cloudflare") {
        rows.push({ label: "Tunnel", value: result.publicAccess.tunnelName });
    }
    rows.push({
        label: "Connection password",
        value: generatedPassword ?? "Set (unchanged)",
    });

    printSummary("Setup complete", rows);
    if (generatedPassword) {
        printWarning("Save the connection password above. Only its hash is stored on this computer; reset the password if you forget it.");
    }
    printInfo("Next step: run codex-mcp open to add and start a project in Web Console, or run codex-mcp start in a project directory.");
    printOutro("Setup complete");
}

/** Configure or replace the public access password manually. */
export async function configureAdminPassword(): Promise<void> {
    if (!canPromptInteractively()) {
        throw new Error("Changing the connection password requires an interactive terminal");
    }
    printIntro("Change connection password");
    printInfo("Change connection password.");
    printWarning("Password requirement: at least 12 characters.");
    const password = await askSecret("New password");
    const confirmation = await askSecret("Enter again");
    if (password !== confirmation) {
        throw new Error("Passwords do not match. Please try again");
    }
    await saveAndVerifyAdminPassword(password);
    printOutro("Connection password changed");
}

/** Ensure first-time public access has a generated password without overwriting an existing one. */
async function ensureGeneratedAdminPassword(
    options: { display?: boolean } = {},
): Promise<string | undefined> {
    if (await hasAdminPassword()) {
        if (options.display !== false) {
            printSuccess("Connection password already exists and will be kept.");
            printInfo("To change it, run: codex-mcp auth");
        }
        return undefined;
    }

    const password = generateAdminPassword();
    await saveAndVerifyAdminPassword(password);
    if (options.display !== false) {
        printSuccess("Connection password generated automatically.");
        printWarning("Save the password below. You will need it when connecting ChatGPT: ");
        printNote("Connection password", password);
        printInfo("The password is not stored in plaintext. If you forget it, run `codex-mcp auth` to set a new password.");
    }
    return password;
}

async function saveAndVerifyAdminPassword(password: string): Promise<void> {
    try {
        await setConnectionPassword(password);
    } catch (error) {
        throw new Error(`Connection password verification failed after saving; run again \`codex-mcp setup\`: ${readableError(error)}`);
    }
}

export async function ensureAdminPasswordConfigured(): Promise<void> {
    if (await hasAdminPassword()) return;
    if (!canPromptInteractively()) {
        throw new Error("No connection password is set. Run `codex-mcp setup` first");
    }
    printWarning("Generate a connection password before first use.");
    await ensureGeneratedAdminPassword();
}

function readableError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
