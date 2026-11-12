# Local Console Design

## Product role

codex-mcp Web is the CLI's local GUI control plane. Except for internal `daemon` entry points and machine-readable output formatting, every user-level CLI capability must have a Web operation. CLI and Web call the same business services.

## Process model

```text
Browser
  │ localhost only
  ▼
Local Controller
  ├─ Web Console / management API
  ├─ setup / auth / doctor / update
  ├─ project registry operations
  └─ runtime lifecycle orchestration
        │
        ▼
     MCP Runtime
       ├─ /mcp + OAuth
       ├─ project runtimes
       └─ Cloudflare Tunnel
```

`stop` stops only MCP Runtime/Tunnel. Controller stays online so the page can start Runtime again. Controller always listens on loopback and is never exposed through Cloudflare.

## Shared business layer

Move business actions out of CLI formatters/terminal prompts into services without UI dependencies:

- Runtime: start / stop / restart / status / runtime intent.
- Project: list / add / remove / info.
- Doctor: check / fix.
- Auth: password status / set password.
- Setup: inspect / public access / Cloudflare login and selection / capabilities / verification.
- Logs: tail / follow.
- Update: check/install, restarting Controller/Runtime when necessary.

CLI owns argument parsing and terminal interaction; Web owns forms, state, and progress presentation.

## Web feature parity

- `start` with `--local`, `--no-tunnel`, `--tunnel-logs`, and `--root`.
- `stop`, `restart`, `status`.
- `project list/add/remove/info`.
- `logs --lines`, `logs --follow`.
- `doctor`, `doctor --fix`.
- Complete `setup`, including Cloudflare login, domains, Tunnel, DNS, public verification, and external capabilities.
- `auth`, `update`, `version`, and `help`.

Internal `daemon` has no Web button. `status --json` is a CLI representation, not a separate business capability.

## Long operations

Setup/update/doctor must not occupy a single long HTTP request. Controller creates an operation and returns its ID. Polling or SSE reports phases, results, and errors; cancellable operations support cancellation. Log following uses SSE.

## Local security boundary

- Loopback-only Controller socket and strict Host/Origin checks.
- Random HttpOnly + SameSite=Strict browser session cookie.
- CSRF tokens for mutations; CLI uses the random control token in Controller state.
- Cloudflare credentials, OAuth tokens, and password hashes never reach the frontend.
- Explicit UI confirmation for dangerous/destructive actions.

Controller management APIs are separate from the public MCP/OAuth listener and never mounted on public routes.

## UI direction

The original design proposed a quiet, content-first local workspace resembling ChatGPT, with Home, Projects, and Connect ChatGPT navigation and maintenance through technical details or Check and repair.

Historical design proposal (the current implementation follows the Vue 3 / Element Plus rules in `AGENTS.md`):

- React, Tailwind CSS, and shadcn/ui patterns based on Radix primitives, with scripts/styles bundled into `dist/ui/console` and no CDN dependency.
- Light canvas `#ffffff`, sidebar `#f9f9f9`, primary text `#0d0d0d`, secondary text `#6f6f6f`; green reserved for healthy services/success.
- Home guides users through Choose project → Connect ChatGPT → Verify connection, shows available projects and a copyable address, and emphasizes the next action.
- Use plain labels such as control panel, MCP service, public connection, connection password, and available tools and skills. Show PID, mode, and internal status in technical details.
- Dialogs for adding projects, connection setup, and dangerous actions; mobile navigation/details use a sheet; feedback uses toasts and a progress panel.
- Dark canvas `#212121`, sidebar `#171717`, panels `#2f2f2f`; mobile uses a left navigation drawer and single-column forms/pages.
- Clear keyboard focus and respect for `prefers-reduced-motion`.

## Project selection and connection checks

- Add project prefers the native folder picker: osascript on macOS, FolderBrowserDialog on Windows, zenity/kdialog on Linux. Cancel does not register a project. Aborting the browser request ends the waiting process; unsupported systems offer suggestions or manual paths.
- Suggestions include existing inactive projects and shallow candidates in common development folders, up to 20 items without recursive home scanning. Selection alone does not register a project; Add project remains required.
- Server validation checks folder existence, directory type, and readability. Ordinary Web addition preserves the current mode; when stopped, it starts locally first, avoiding accidental public mode switches.
- Projects show persisted session selections, last use, and anonymous IDs. These are historical bindings, not online status, and expose no raw client identifiers.
- Connection checks use the running MCP handler for initialize, tools/list, and read-only project_control(list), then verify that the public address reaches the same instance and returns an authentication challenge. Internal probes accept only fixed actions; management endpoints require the local control token.
- Checks do not simulate ChatGPT account authorization or treat a configured address as connected. Complete account authorization in ChatGPT. Results explain their scope and are cleared when configuration or runtime instance changes.

## Acceptance criteria

1. Web Console remains available after Runtime stops and can restart it.
2. User-level CLI capabilities have Web equivalents.
3. CLI/Web share core business logic.
4. Web mutations leak no Controller token; cross-site requests cannot trigger actions.
5. Setup/update/log following show clear progress and errors.
6. Existing MCP/OAuth/SSRF/project isolation/Tunnel transaction regressions remain intact.
7. Typecheck, tests, and package smoke pass on Node 22 and the current Node version.
