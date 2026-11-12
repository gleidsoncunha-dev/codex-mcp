# AGENTS.md

## Project identity

- This repository is a native coding MCP for ChatGPT, built around a local Controller, MCP Runtime, project registration/session bindings, OAuth/public access, and Web Console.
- Web Console is a local control plane, not a standalone SaaS. Its main entry is `src/ui/console/**`; the stack is Vue 3, TypeScript, Element Plus, and Vite.
- Controller and CLI should reuse shared services such as `src/control/services.ts`. Do not duplicate business rules in Web or CLI, except for UI-only state.
- Prefer minimal, runnable, verifiable changes. Do not expand the diff for stylistic consistency, premature abstraction, or unrelated technical debt.
- Being a personal tool does not justify weakening OAuth, CSRF, Origin, SSRF, path isolation, Cloudflare ownership, or persistence transaction boundaries.

## Execution protocol

Before changing files, in order:

1. Read the applicable `AGENTS.md`.
2. Check `git status`; distinguish existing dirty files from this task's changes and leave unrelated files alone.
3. Trace the active CLI → Controller → service → Runtime / Tunnel and Web route → component → API → service paths. Old files without active entry points or callers are not evidence of current behavior.
4. Check the request for false premises, logical gaps, or missing information. Distinguish facts, inferences, and opinions; point out conflicts directly.
5. For external systems, establish ownership and rollback boundaries. Never overwrite/delete Cloudflare DNS/Tunnels, OAuth clients, files, or project state based on names or guesses.
6. Define the smallest necessary scope and least expensive verification that proves the result before editing.
7. If real testing reveals another root cause, add a behavioral regression before fixing it. Do not write tests that merely mirror the implementation.

## Lifecycle invariants

- `project add/remove` changes registration only; it does not implicitly start Runtime.
- `open` only ensures Controller / Web Console availability; it does not start Runtime.
- `start` starts Runtime using explicit options or persisted preferences. Register the project before Runtime prerequisite checks.
- `stop` stops Runtime/Tunnel only; Controller and Web Console remain online.
- Only `shutdown` closes both Runtime and Controller.
- Configuration, persisted state, and observed runtime state are distinct; UI/CLI must not present one as another.
- Runtime, Tunnel, and Controller operations need their own real deadlines; health-check timeouts must not be reused for startup/shutdown.

## Web Console architecture

- Page components orchestrate pages and interaction state. All network requests go through `src/ui/console/api.ts`; pages must not construct Controller URLs, CSRF, or fetch infrastructure.
- Web calls Controller APIs only. Shared services own business semantics so CLI and Web behave consistently.
- `App.vue` owns global navigation, cross-page state, and lifecycle. Views/components retain local responsibilities; do not pile all logic back into the root.
- External CLI, Runtime, or config changes can happen while the page is open. Provide explicit state synchronization rather than relying only on manual refresh.
- Whoever creates async requests, EventSource, timers, AbortController, or native pickers must clean them up. Unmounts, dialog closure, and Controller replacement must not leave unowned tasks.
- Stale async results must not overwrite newer page state. Prevent concurrent polling/refresh races and unlock relevant UI only after long operations finish.
- Background refresh must not silently overwrite unsaved form edits. Distinguish server state from draft state when synchronizing changes.

## Vue / Element Plus

- Use Vue Composition API and explicit TypeScript types. Do not add Pinia unless actual cross-page complexity justifies it.
- Keep component-scoped Element Plus imports. Do not restore `app.use(ElementPlus)` or the full `element-plus/dist/index.css` import.
- Prefer Element Plus for common Button, Dialog, Drawer, Table, Tabs, Form, Switch, Message, and MessageBox components instead of rebuilding general UI primitives.
- Every Dialog/Drawer needs an explicit cancel/close path. Prevent duplicate async submissions while making the active operation understandable.
- Default user-facing copy is English. Show PID, revision, Tunnel ID, commands, and other internal details only where needed, without cluttering the home page.
- Action labels must describe their actual effects: for example, "Generate and set password" must not imply generation only.

## UI / CSS

- Web Console is a simple local tool console. Prioritize status, next actions, and recoverable errors rather than decorative cards, redundant text, and animation.
- The original desktop admin reference was an author's local `jdny-shop-admin` checkout. Preserve its workspace feel: stable sidebar, 64px top bar, gray workspace, white surfaces, light borders/shadows, and 24/16/12 spacing. Do not copy its commerce-specific components or green branding.
- Keep collapsible desktop admin navigation (about 228px expanded, 64px collapsed). Use workspace width rather than a centered narrow website layout. Do not repeat a large page title when the top bar already provides it.
- Desktop and narrow screens must work. Check important layouts at about 1440×900 and a narrow mobile viewport, not just DOM mounting.
- Reuse tokens from `src/ui/console/styles.css` and Element Plus. Do not scatter new color, shadow, or radius systems across components.
- Use flex/grid for main layout and `gap` for sibling spacing. Do not rely on effects such as `backdrop-filter` for readability.
- Responsive structural rules need clear priority so component CSS loading order cannot accidentally override important display/layout rules.
- Destructive actions require confirmation and clear consequences; ordinary refresh, copy, and viewing do not need extra confirmation.

## State and feedback

- Successful Web actions must promptly reflect actual server state, not just show a toast.
- When CLI and Web run together, projects, sessions, Runtime, connection addresses, and password status should sync within a reasonable interval. Refresh immediately on window focus.
- Avoid frequent background polling while hidden; sync immediately when visible again.
- Global busy state must support concurrent owners. A second short action finishing must not unlock an earlier long action.
- SSE/log/long-operation disconnections must remain observable and permit reconnection or recovery; never remain stuck processing forever.
- Connection checks and doctor terminology must match the product architecture. "Project" means a project, not a generic check or issue.

## Cloudflare / OAuth / security boundaries

- Web Console always listens on loopback only. Browser mutations continue to require a local session, same origin, and CSRF.
- Never put passwords, OAuth tokens, private keys, or Cloudflare credentials in DOM, URLs, ordinary logs, or test output. Show generated passwords briefly only after an explicit user action.
- Automatically modify/clean Cloudflare resources only with proof they belong to codex-mcp. Before deleting DNS, verify it still points exactly to the expected Tunnel.
- When switching public access, validate the candidate, commit local configuration, then clean old resources. Compensate failures/cancellations according to the current transaction boundaries.
- Reuse Tunnels based on reliable ownership (known IDs, matching local account credentials, unambiguous remote state), not guesses from hostname or Tunnel name.
- Treat Cloudflare soft-deletion fields such as `deleted_at` as deleted; GET 200 alone does not prove existence.
- Changes to OAuth, PKCE, refresh/revoke, or proxy hostname routing must also cover failure, replay, and cross-host negative paths.

## Verification

- Never report unexecuted tests, browsers, operating systems, or external flows as passed.
- After TypeScript/Vue changes, run at least `npm run typecheck`.
- For Web entry, Vite, Element Plus imports, build, or critical CSS layout changes, run build/full tests and verify related pages in a real browser.
- For Controller/Runtime/Tunnel/OAuth changes, run related behavioral tests. Real Cloudflare tests require isolated HOME, independent ports, and temporary domains; clean exact resources afterward and confirm production was unaffected.
- Release changes require at least `npm test`, `npm run test:package`, and `git diff --check`.
- Automated tests do not replace real lifecycle validation. State which external paths were not verified because of environment limitations.

## Git

- Protect unrelated pre-existing dirty files before and after editing. Do not format or delete unrelated files.
- Commit only when the user explicitly requests committing code; push only when the user explicitly requests pushing code. The user's workspace-wide instructions authorize this cycle for application changes.
- Stage only task files and inspect the staged diff before committing.
- Keep `AGENTS.md`, tests, and implementation consistent. Do not hide rule changes in unrelated feature commits.
