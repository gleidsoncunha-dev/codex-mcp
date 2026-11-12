# English edition handoff

Date: 2026-11-12 (America/Sao_Paulo).

## Scope and provenance

- User requested English throughout the project after using the upstream Mac version.
- Starting point: upstream `meesii/codex-mcp`, commit `ce99f73`, clean checkout.
- Version: **1.2.1** (patch for the English edition); package.json and package-lock.json synchronized. Runtime/UI read the package version.
- Branch: `english-translation`; user-owned fork: https://github.com/gleidsoncunha-dev/codex-mcp. Original remote retained as origin; fork remote named fork.
- No application account, production configuration, Cloudflare resource, OAuth grant, or existing installation was changed.

## Changes

- English Web Console navigation/forms/status/confirmations/errors, CLI help/prompts/diagnostics, OAuth pages, native folder pickers, tool labels/cards, managed-tool messages, installation/uninstallation scripts, and release workflow labels.
- Element Plus locale and explicit date/HTML locales use English. Removed Chinese-specific UI font preferences. Widened mobile navigation to fit English labels.
- Translated all tracked documentation and agent instructions. Repeated historical passages were consolidated while retaining ADR and issue identifiers, decisions, technical boundaries, and historical results. The English-default rule explicitly supersedes the old Chinese-default wording.
- Existing behavioral tests now assert English messages. Unicode path fixtures retain their non-Latin values through Unicode escapes.
- README distinguishes the English checkout from upstream installation/update channels. Upstream package identity, license/copyright, CLI names, protocol/config fields, and security boundaries remain intact.

## Local validation

- npm ci from official registry: passed on Windows, Node 24.15.0/npm 11.12.1.
- npm run typecheck: passed.
- npm test: **58 passed, zero failed/skipped**, including build, lifecycle, OAuth/security, tools, and Tunnel compensation.
- npm run test:package: passed; real tarball installed in an isolated home and CLI/Controller exercised.
- npm pack: local English artifact `meesii-codex-mcp-1.2.1.tgz`.
- git diff --check: passed.
- Scan of tracked source/scripts/tests/docs/workflows: no literal Han characters remaining. Escaped non-Latin path fixtures still exercise Unicode support.
- Real Edge/Playwright rendering of Overview, Projects, Connection, and System at **1440×900** and **390×844**: English text, no page errors, no document horizontal overflow. Screenshots/logs are local under .git and are not shipped.
- Validation used temporary home/config and local loopback ports; no production Tunnel or user account authorization was exercised.
- This Windows validation does not constitute a real MacBook/ChatGPT account acceptance test. Cross-platform CI is tracked separately below.
- The workstation's npm script-shell pointed to a Git Bash environment without required utilities. Validation used process-local npm_config_script_shell pointing to Windows cmd.exe; no persistent environment setting was changed.

## Publication gates and blockers

- Production dependency audit fails with **14 existing findings: 7 moderate, 6 high, 1 critical** in the upstream lock. This batch changes only the lockfile version, not dependency versions. Dependency remediation is a separate functional batch.
- Do not disable or bypass mandatory CI audit checks, merge on failing checks, or claim an official release.
- The fork has no repository secrets. The configured npm publication targets the author's `@meesii/codex-mcp` namespace, which is not this user's distribution identity. No npm publish, release tag, or release workflow was triggered.
- A verified local package is available for use. The existing updater/install scripts still follow upstream; they can replace the English build. Use the local English tarball/source instructions in README.
- GitHub CI, push, and final publication status will be recorded after the branch is pushed. No deployment is claimed by local build/browser/package success.

## Next work

1. Resolve upstream dependency audit findings without weakening gates, with a separate versioned/tested batch if requested.
2. If a maintained independent distribution is desired, select its npm scope/update/release channel before changing publication configuration.
3. Test the English artifact on the user's MacBook and complete real ChatGPT authorization there.
