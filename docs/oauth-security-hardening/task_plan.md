# OAuth and Security Hardening Task Plan

Historical plan for the work begun 2026-08-07. Completion/test statements below belong to that work, not the English translation release.

## Goal

Convert unauthenticated public coding MCP into a single-user service protected by a built-in OAuth 2.1 Authorization Server, and fix the security, correctness, resource, Cloudflare, downstream, UI, Windows, dependency, and testing findings from the full review.

## Confirmed design

- Built-in AS; one administrator password, no multi-user/tenant model.
- Authorization Code + PKCE S256; opaque access/refresh; rotation; offline_access.
- Prefer CIMD; DCR fallback for older clients/ChatGPT.
- Public OAuth mandatory; refuse unprotected startup without a password.
- --local forces loopback and permits noauth debugging.
- Initial scope retains Streamable HTTP sessions rather than combining the separate 2026-07-28 stateless transport migration. See later ADR-029 for that migration.

## Completion criteria (historically complete)

1. Public /mcp cannot enter transport without a valid bearer.
2. Automated metadata/authorize/token/register/revoke/PKCE/rotation tests.
3. File tools cannot escape root through ordinary/dangling symlinks.
4. Confirmed bugs fixed with regressions or focused executable evidence.
5. Do not overwrite global cloudflared config or silently delete Tunnels/overwrite DNS.
6. Bounded sessions/processes/output.
7. Preserve valid downstream content, reject automatic remote metadata/instructions trust, remove immutable-catalog guarantees.
8. No permanent 4Hz UI polling.
9. Correct Windows CRLF, Unicode installer, and interrupt documentation.
10. Typecheck/test/build pass; historical production audit zero.
11. README matches authentication/security behavior.
12. Final diff contains task changes only (see final_report.md).
13. R-029–R-052 fixed with regressions, including private_key_jwt, safe proxy/CIMD/JWKS, cross-family BlockList, route proof, required jti, bounded-timeout retries, Chrome CSP, native authorize, and token-endpoint audience.

## Phases

### Phase 0: Baseline, standards, records — complete

- [x] Full review and issue inventory.
- [x] User selects built-in OAuth and one administrator password.
- [x] Check 2026-07-28 OAuth/CIMD direction.
- [x] Create this work directory; track it while ignoring other local reference clones.

### Phase 1: OAuth core/public HTTP — complete

- [x] Argon2id/password persistence and auth CLI.
- [x] Discovery/authorize/token/revoke/DCR.
- [x] Safe CIMD fetch, exact client_id/name/redirect validation, none/private_key_jwt with RS256/JWKS/replay protection.
- [x] Code/access/refresh lifetimes; mandatory bound resource at authorization/code/refresh; replay-family revoke.
- [x] Explicit scopes require mcp:tools.
- [x] Public-only DCR, public-key CIMD, no shared secrets.
- [x] Issuer binding, bounded registration/eviction, per-client/global limits.
- [x] Bearer /mcp gate, 401 challenge, password prerequisite; loopback local noauth.
- [x] Cloudflare-aware keys; approval per-client/global plus two concurrent hashes.
- [x] Password resets invalidate old generations; revoke ownership; redirect/loopback warnings.
- [x] OAuth-client-owned MCP sessions and OAuth E2E.

### Phase 2: File safety/correctness — complete

- [x] Canonical roots, symlink-aware guard, directory/dangling escapes.
- [x] Literal edit replacement, reject empty old_string, preserve CRLF.
- [x] Streaming bounded reads/lists/searches; minimatch replaces custom glob.

### Phase 3: Network/process/resources — complete

- [x] Shared SSRF-safe HTTP, per-hop redirects, streaming limits, special IPv6 ranges; webfetch uses it.
- [x] Ripgrep/Worker regex/cloudflared time/output/tree budgets.
- [x] TERM→KILL timeouts and async shutdown; nonzero exec/stdin error semantics.
- [x] Session/process quotas and initialize limits; per-session scopes/capacity/cleanup.
- [x] No sensitive path in healthz.

### Phase 4: Metadata/downstream/UI — complete

- [x] Public OAuth2/local noauth schemes and truthful risk annotations.
- [x] Local-key-only parent instructions; listTools reconnect; preserve rich content.
- [x] Environment-only secret references, Unix 0600, HTTPS remote policy.
- [x] Remove immutable-catalog promise; bounded event-first card polling; redact commands/URLs.

### Phase 5: Cloudflare/Windows — complete

- [x] Separate codex-mcp cloudflared config.
- [x] Explicit Tunnel deletion/DNS overwrite confirmations.
- [x] Unicode-safe Windows launcher and accurate Ctrl-C/tree-kill wording.

### Phase 6: Dependencies/CI/docs/verification — complete

- [x] Refresh official-registry lock, Hono 4.13.0, historical audit zero.
- [x] Node22 Ubuntu/macOS/Windows checks and Linux audit; test TypeScript included.
- [x] README authentication/security/Cloudflare updates.
- [x] Canonical public hostname validation (IDN/IP/credentials/labels).
- [x] Focused Node22 compatibility, clean npm ci, diff check.
- [x] Close 52 issues and finish progress/final report.

## Errors and iterations

| Finding | Attempts | Resolution |
|---|---:|---|
| Missing node_modules/tsc | 1 | Install, then baseline typecheck/test/build passed |
| npmmirror lacks audit API | 1 | Use official registry; refresh final lock URLs |
| Tilde skill path resolved relative to workspace | 1 | Use absolute home path |
| Assertion consumed Fetch body early | 1 | Read response.clone().text() |
| Large ls patch had ambiguous exact block | 1 | Split into smaller exact patches; no bad write |
| SDK tools/list omitted top-level securitySchemes | 1 | Also populate _meta; centralize per server |
| Old localhost-success case survived safe HTTP change | 1 | Replace with SSRF rejection regression |
| Dangling-symlink new-file escape | 1 | lstat/readlink canonicalization and regression |
| SDK optional resource/CIMD client_id stripping | 1 | Enforce profile in provider/state; negative tests |
| Revoke lacked authenticated ownership | 1 | Bind clientId; two-client E2E |
| Newly checked test TS exposed resource union errors | 1 | Explicit text/blob narrowing; retain typecheck gate |
| Nonreproducible first Node22 argument-count error | 1 | Repeat source/test checks and OAuth/security/tools E2E; no speculative fix |
| Lock-only refresh kept npmmirror URLs | 2 | Full update --package-lock-only --replace-registry-host=always --force; zero old URLs |
| Misread generic RFC jti optionality | 2 | Apply OpenID private_key_jwt required jti, replay cache, short unique jti regression |
| Pinned proxy reset/internal timeout lacked errno | 3 | Keep DoH/IP pinning; bounded keep-alive, exact timeout retry; no TLS retry; real CIMD 10/10 200 |
| Chrome callback/pending expiry | 2 | Diagnose form-action/302, then replace approve/pending with native authorize GET/POST and revalidation |
| Token exchange unexpected aud | 1 | Follow final RFC/OpenID issuer-or-token-endpoint rules, reject mixed audiences, add exchange/refresh/revoke tests |

See decisions.md for architectural records.
