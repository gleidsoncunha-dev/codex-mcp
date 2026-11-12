# codex-mcp

Let ChatGPT work directly on code projects on your computer. Ask it to explain a project, inspect changes, fix an error, run tests, finish a feature, or switch projects. codex-mcp reads files, edits code, runs commands, inspects Git, and returns results to ChatGPT.

To reduce ambiguity, the multi-project daemon exposes 15 top-level tools: `project_control`, `read`, `read_image`, `apply_patch`, `ls`, `grep`, `glob`, `code_explore`, `exec_command`, `write_stdin`, `skills_list`, `skill_read`, `mcp_tools`, `mcp_call`, and `summary`. Git and package management use `exec_command`.

> This is a powerful local tool for personal development. Connect only your own ChatGPT account and trusted projects.

## English edition

This checkout translates the interface, CLI, OAuth pages, tool cards, installers, and documentation. The original [meesii/codex-mcp](https://github.com/meesii/codex-mcp) is MIT licensed. Upstream npm/packages/scripts below install the upstream edition. Run this English checkout with:

```bash
npm ci
npm run build
node dist/cli.js open
```

For global installation, run `npm pack`, then `npm install -g /path/to/generated-package.tgz`. The existing `codex-mcp update` follows upstream and may replace this translation; reinstall the English artifact to retain it. See [HANDOFF.md](HANDOFF.md) for delivery status.

## Architecture

```text
Web Console / CLI
       ↓
Local Controller ── Projects, configuration, logs, diagnostics, updates
       ↓
MCP Runtime ─────── Tools, OAuth, project runtimes
       ↓
Cloudflare Tunnel or your own HTTPS endpoint
       ↓
ChatGPT
```

Controller listens locally and manages state. Runtime starts/stops independently. `stop` leaves Web Console available for repairs; `shutdown` closes both.

All projects share **one Runtime**. `project add` only registers; `start` registers first, then starts Runtime in the saved mode. Each conversation binds to one project, and different conversations can work independently. ChatGPT supplies a stable conversation ID. Other clients without conversation metadata or persistent MCP sessions fall back to a shared OAuth-client binding; maintain independent MCP sessions for them.

## Requirements

- Node.js **22 or later**.
- Git is recommended for status, history, and diffs.
- ChatGPT access needs public HTTPS reaching local codex-mcp. A Cloudflare account and domain already connected to it enable automatic Tunnel management. An existing reverse proxy/server/HTTPS endpoint also works.
- Codex, Claude Code, and Agent Skills are optional capability sources; core functionality does not require them.

# Quick start

## 1. Install

Upstream npm installation:

```bash
npm install -g @meesii/codex-mcp
```

Upstream macOS / Linux script:

```bash
curl -fsSL https://github.com/meesii/codex-mcp/releases/latest/download/install.sh | sh
```

Upstream Windows PowerShell script:

```powershell
irm https://github.com/meesii/codex-mcp/releases/latest/download/install.ps1 | iex
```

If the command is missing, reopen the terminal. Check `codex-mcp --version`.

## 2. Open Web Console (recommended)

```bash
codex-mcp open
```

This starts Controller and opens the console, **without starting Runtime or automatically changing public configuration**.

1. Add directories under **Projects**.
2. For ChatGPT, open **Connection**: **Public address → Connection password → Check connection**.
3. Return to **Overview** and select **Start public service** or **Start locally**.
4. Manage capabilities, diagnostics, logs, and updates under **System**.

CLI-only use is supported:

```bash
codex-mcp project add /path/to/project
codex-mcp setup        # Only for public ChatGPT access
codex-mcp start
```

### Public access

Automatic setup prepares cloudflared, opens Cloudflare login, reads/selects a domain, and creates/reuses the computer's Tunnel. Existing services stay online while the candidate is prepared and pause briefly for actual switching. The candidate must connect before DNS changes.

Setup saves old DNS, switches to the candidate, and verifies that a random public probe returns to this computer within the default fallback window of at most five minutes. Ctrl+C safely cancels. Only successful verification atomically commits local configuration; failures restore DNS and preserve the previous usable config.

Example: `https://codex-mcp.example.com/mcp`. Automatic setup requires a domain already connected to Cloudflare. `<UUID>.cfargotunnel.com` is only a CNAME target, not a ChatGPT MCP address.

For your own HTTPS endpoint, choose it in setup, enter its domain, and securely forward `https://your-domain.example/mcp` to local codex-mcp.

### Password and capabilities

After public verification, setup generates the connection password. **Save it.** Only its hash is stored; plaintext cannot be recovered. Reset with `codex-mcp auth`.

Setup then detects Codex, Claude Code, and Agent Skills. Use all, customize MCP/Skills sources, or disable all. Automatic sync is recommended. A source missing in the current directory does not disable the same source already enabled elsewhere. Cancelling this optional step preserves completed connection/password setup.

## 3. Start a project

```bash
cd /path/to/your-project
codex-mcp start
```

Registration precedes Controller/Runtime startup, so it survives public configuration errors; CLI provides a console address for repairs. Without public config, plain start defaults to **local mode**. Explicit local/public modes are saved and reused by later starts. Repeated starts refresh state and reuse one server.

```bash
codex-mcp start --root /path/to/your-project
codex-mcp status
```

Status includes Controller/console, Runtime/current/default mode, local/public URLs, Tunnel, CLI/daemon versions, restart advice on mismatches, projects, and binding counts.

## 4. Connect ChatGPT

Entry points/plans can change; follow your account's current Apps settings. Typically enable **Developer Mode**, open **Apps → Create**, enter the public MCP URL, scan tools, finish OAuth using the setup password, then create/enable the App. You can then work on local projects. Full write access depends on plan, workspace permissions, and product availability; check account support if custom Apps/Developer Mode is missing.

# Multiple projects

A registered project comes from Console, project add, or start. A conversation binding selects one registered project as file/command context. Registration belongs to local Controller/CLI; models only select existing registrations using project_control.

```bash
cd ~/code/api
codex-mcp start
cd ~/code/web
codex-mcp start
cd ~/code/mobile
codex-mcp start
codex-mcp project list
codex-mcp project add /path/to/project
codex-mcp project info <project-ID-name-or-directory>
```

All projects share one service/port/Tunnel. Ask ChatGPT to use the web project and inspect its home page; another conversation can independently use api. Ask to switch projects explicitly. Existing bindings require confirmation before switching.

Clear old bindings individually/all together in Projects, or run `codex-mcp bindings clean [project]`. Only selected bindings are cleared; conversations/files remain and sessions must select a project again.

Deactivate with `codex-mcp project remove <project-ID-name-or-directory>`; omit the target inside its directory. Other projects/service/Tunnel continue. Reactivate with start or project add.

`stop` closes Runtime, project runtimes, and Tunnel, preserving registrations and Controller/Console. `restart` restarts Runtime in its current mode. `shutdown` closes everything.

# Capabilities and boundaries

- Read/search files, strings, regex, patterns, directories, and code relationships.
- Use transactional apply_patch for precise replacements and batch create/overwrite/delete, with rollback on commit failure.
- Run builds/tests, install dependencies, start servers, and manage long processes.
- Use existing Git through exec_command.
- Select one registered project per conversation using project_control, then inspect code/skills/command results.

File tools and command working directories stay within the bound project root. Relative paths begin there. Register other directories separately and switch explicitly; absolute paths do not bypass file tool boundaries.

> This is not a complete OS sandbox. Shell commands retain the system user's permissions.

# Codex, Claude Code, and Skills

| Source | MCP | Skills |
|---|---:|---:|
| Codex | Yes | Yes |
| Claude Code | Yes | Yes |
| Agent Skills | — | Yes |

Common locations are `~/.codex/`, `~/.claude/`, and `~/.agents/skills/`; project `.claude/skills` is also supported. Configurations/tokens/skill files are referenced in place, not copied into ~/.codex-mcp. Run setup → **Manage external capabilities**. `watch` refreshes changes automatically (recommended); `startup` reads once at launch.

# Command reference

| Command | Effect |
|---|---|
| `codex-mcp` | Help without startup |
| `codex-mcp open` | Start/reuse Controller; open Console; no Runtime startup |
| `codex-mcp start` | Register current project; start/reuse Runtime in saved mode |
| `codex-mcp status [--json]` | Controller, Runtime, modes, Tunnel, projects; JSON includes Console URL |
| `http://127.0.0.1:<Controller-port>/` | Full local GUI for user-level CLI operations |
| `codex-mcp restart` | Restart Runtime; retain Controller/registrations |
| `codex-mcp stop` | Stop Runtime/Tunnel; retain Controller/Console |
| `codex-mcp shutdown` | Close everything |
| `codex-mcp project list` | Registered projects |
| `codex-mcp project add [directory]` | Register only; default current directory; no Runtime startup |
| `codex-mcp project remove [project]` | Deactivate; default current directory |
| `codex-mcp project info [project]` | Project details |
| `codex-mcp bindings clean [project]` | Interactive old-binding cleanup; default current project |
| `codex-mcp logs [--lines N]` | Recent logs |
| `codex-mcp logs -f` | Follow logs |
| `codex-mcp setup` | Initial setup / manage existing configuration |
| `codex-mcp doctor [--fix]` | Read-only checks; safe local repairs with --fix |
| `codex-mcp auth` | Change connection password |
| `codex-mcp update` | Update from upstream |
| `codex-mcp start --root <directory>` | Register specified directory |
| `codex-mcp start --local` | Switch/save local mode, no public access |
| `codex-mcp start --public` | Switch/save public mode; requires public config/password |
| `codex-mcp start --no-tunnel` | Public mode without automatic Tunnel startup |
| `codex-mcp start --tunnel-logs` | Mirror Tunnel logs |
| `codex-mcp --version` | Version |
| `codex-mcp help` | Help |

# Setup management

Running setup again offers configuration checks, public access changes, Cloudflare login/account switching, password changes, capabilities, or exit without changes. Checks prove the public address reaches this instance and only read committed config/runtime: no login, DNS mutation, or Tunnel rewrites.

Changes retain complete runtime arguments/registrations, safely pause for switching, then restore the previous arguments. Project/binding files are not reset.

# Data and logs

Default directory: `~/.codex-mcp/`.

| File | Contents |
|---|---|
| config.json | Listening address, public access, capabilities, client policy, UI |
| controller.json | Local Controller PID, loopback port, random control credentials |
| daemon.json | Runtime state; removed on stop, Controller remains |
| projects.json | Registrations |
| session-bindings.json | Conversation/project bindings |
| logs/ | Runtime logs |

Cloudflare credentials are managed here rather than relying on system ~/.cloudflared as durable runtime state. Structured logs resemble `codex-mcp.2026-08-12.0.jsonl`; raw Tunnel logs use `logs/tunnel.log`. Ordinary logs record tool names/durations/outcomes, not raw commands, file contents, complete responses, or OAuth credentials.

# Diagnostics and troubleshooting

Doctor checks Node, Git, search tools, config/password/public address, cloudflared/login/Tunnel credentials/config, and capabilities. `doctor --fix` restores pinned managed ripgrep with SHA-256/version verification, creates missing directories, and clears stale daemon state without reinstalling everything.

- **Command missing:** reopen terminal, then reinstall if needed.
- **ChatGPT cannot connect:** run status/doctor, check service/public URL/Tunnel, then inspect logs.
- **Forgotten password:** reset with auth; plaintext cannot be recovered.
- **Wrong Cloudflare account:** select login/account switching. A temporary login is verified before replacing old credentials; failure/cancellation preserves them and leaves system ~/.cloudflared alone.
- **Old Tunnel mismatch:** rerun setup. A same-name Tunnel lacking local credentials is kept; create a uniquely suffixed candidate. Only new, uncommitted candidates with no DNS references are automatically removed.
- **Tunnel cannot connect:** inspect tunnel.log; firewalls may block TCP 7844. IPv4 is preferred and timeouts provide specific hints.
- **New tools missing:** refresh/republish/reconnect the MCP App and rescan the 15-tool ABI. Removed actions have no compatibility aliases.
- **One server per project?** No; register all with the same background service/Tunnel.
- **Closing terminal:** normal start keeps running in the background. Check status or stop explicitly.

# Updates

## Clean 1.0 baseline

Version 1.0 deliberately breaks old commands/config/OAuth state. Before a first pre-1.0 upgrade, stop with the old CLI, back up ~/.codex-mcp, move aside config.json, oauth-state.json, daemon.json, projects.json, and session-bindings.json, then rerun setup.

Keep ~/.codex-mcp/npm, managed tools, password, and Cloudflare credentials. Old sessions/bindings do not return; register projects again. Do not remove the whole directory: it also contains script-installed CLI files. Replace old tunnel with setup, exit with stop/project remove, and serve --foreground with background start.

Routine post-1.0 updates preserve config/password. Run `codex-mcp update`, then `codex-mcp restart` so CLI/daemon versions match; status reports differences. For this English edition, follow the installation note above to avoid replacing it with upstream.

# Uninstall

For npm installations: `npm uninstall -g @meesii/codex-mcp`.

For script installations:

```bash
curl -fsSL https://github.com/meesii/codex-mcp/releases/latest/download/uninstall.sh | sh
```

```powershell
irm https://github.com/meesii/codex-mcp/releases/latest/download/uninstall.ps1 | iex
```

Configuration/passwords are preserved by default. Once certain all state is unwanted, manually remove ~/.codex-mcp.

# Security

Do not share your instance/password. Register only trusted directories. Shell commands retain system-user permissions; manage production keys, SSH keys, and sensitive files using normal local development security practices. Public password authentication does not replace OS isolation.

# Advanced: tool-list compatibility

ChatGPT caches approved actions. Refresh/republish after upgrades to replace old snapshots with the complete 15-tool set. Project selection uses project_control; removed tools have no aliases.

# Local development

```bash
npm ci
npm run typecheck
npm run build
npm run dev
```

Local-only debugging: `npm run dev:once -- --local`. Releases require Node 22. Linux/macOS/Windows CI runs typecheck, full tests, and isolated real-tarball installation smoke. Distribution uses the same tested artifact.

# License

[MIT](LICENSE)
