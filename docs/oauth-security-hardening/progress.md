# Progress Log

## 2026-08-07 — historical remediation

These entries record the earlier implementation and test evidence. They are not current-release validation; see the repository handoff for the English edition.

### Baseline and review

- Opened the clean main...origin/main checkout; read README/package, HTTP/MCP, tools/process/downstream, Cloudflare/UI/installers/tests.
- Installed missing node_modules; typecheck/test/build passed.
- Confirmed 28 issues, with independent temporary PoCs for symlink escape and deep glob bugs. Official audit found the old Hono 4.12.33 moderate advisory.
- User chose built-in OAuth and one password; created this tracked work directory while continuing to ignore local reference clones.

### OAuth / HTTP

- Added private atomic storage/mutex, Argon2 password storage/auth CLI, persistent DCR and digest-only OAuth state, resource/issuer binding, rotation/replay revocation.
- Added SDK provider/CIMD/cap/password UI/RFC9207 and AS metadata/CIMD flag/router/Bearer/CF-aware limits.
- Public MCP requires OAuth/password; local forces loopback/noauth. End-to-end tests cover discovery through bearer tool calls, rotation, replay, and secret non-persistence.
- Final review enforced mandatory matching resource at authorization/code/refresh; exact CIMD ID/name/redirect/auth-method validation; full redirect/loopback warnings.
- Native authorize GET/POST replaced approve/pending; revalidate all OAuth parameters on POST and omit callback-blocking form-action.
- Revoke ownership tested with two clients. CIMD cache honors no-store/max-age up to 24h.
- Approval limits: 60/15m global, 12/15m/client, two concurrent Argon2 checks. DCR stays public-only; CIMD adds standard public-key private_key_jwt without shared secrets.
- Registration: 100/day globally, 10/hour/client, 256 stored, safe oldest-inactive eviction. Explicit scopes require mcp:tools; offline_access alone is invalid_scope.
- Password reset changes credential generation, invalidating old grants in running/restarted servers. E2E verified 401/invalid_grant and concurrent 429 behavior. Historical sessions gained OAuth-client ownership.

### File boundaries / correctness

- Canonical ProjectContext root and lexical+canonical path guard for existing/new/symlink/dangling/cyclic paths.
- Literal edit callbacks, reject empty old_string, streaming read preserving CRLF with 80k output/line limits.
- minimatch globstar; scan/output budgets for grep/ripgrep/ls. Regressions cover links, replacement metacharacters, CRLF, deep globs, and large reads.

### Network / process

- Shared DNS/IP-safe HTTP with per-hop redirects, streaming caps, timeouts; webfetch/CIMD/JWKS reuse it.
- Standard/macOS HTTPS proxy support uses independent DoH, globally validated A/AAAA, IP-pinned CONNECT, original Host/SNI/cert, bounded keep-alive, and limited transport-error failover. HTTP stays outside this proxy path.
- Ripgrep/cloudflared time/output/tree budgets, TERM→KILL, Worker regex caps; asynchronous process shutdown.
- Historical process limits: eight globally/four per MCP scope, foreign-ID invisibility and scope cleanup. Nonzero exec/stdin reports error. MCP max 32, initialize limits, healthz only ok:true.
- Regression checks: private IPv4/IPv6, byte limits, quotas, shutdown, no-password refusal. Expanded denial for special IPv6 ranges.

### Downstream / UI / metadata

- Central public OAuth2/local noauth schemes and truthful destructive/open-world hints.
- Parent instructions trust local keys, not remote metadata. Preserve rich image+text results, reconnect after disconnection, remove immutable-catalog promise.
- Event-first cards with about ten-second bounded fallback/final stop; hide command text and sensitive URL parts.
- Sensitive config values require environment references; missing env fails, Unix 0600, HTTPS except loopback.

### Cloudflare / Windows

- Private cloudflared config path; explicit confirmation for remote deletion/DNS overwrite, with deny/allow tests.
- Windows UTF-8 absolute-path ps1 launcher and ASCII relative cmd shim.
- Correct Unix SIGINT versus Windows forced process-tree interrupt wording.

### Dependencies / CI / documentation

- Added argon2 2.0.2/minimatch 10.2.6; SDK minimum ^1.30.0. Real integration added jose and https-proxy-agent; the historical change did not retain an unneeded http-proxy-agent.
- Full official-registry lock refresh, Hono 4.13.0, zero historical production audit findings.
- Node22 Ubuntu/macOS/Windows CI; Linux audit; source/test TypeScript checks.
- Updated README OAuth/security/Cloudflare/local mode/tests. Canonical hostname validation includes IDN punycode and rejects IP/localhost/credentials/non-HTTP(S)/invalid labels.

## Recorded final validation

Node24 clean-install chain: official-registry npm ci, typecheck, six test groups, build, production audit, and diff check passed. Groups: user-mcp-config, tools.e2e, mcp-gateway.e2e, security-regressions, private-key-jwt, oauth.e2e. Audit was zero at that time.

Focused Node22.23.2: source/test compilation, private-key/security/OAuth/tools passed. An initial argument-count error was not reproducible; repeated checks passed, so no speculative change was made.

Recorded dependency versions: SDK 1.30.0; @hono/node-server 2.1.0; Hono 4.13.0; argon2 2.0.2; https-proxy-agent 9.1.0; jose 6.2.8; minimatch 10.2.6. Lock URLs: npmmirror zero, npmjs 164.

## Historical completion status

- Original 28 and follow-up R-029–R-052 all fixed; every plan phase complete.
- Final diff/untracked review contained only remediation source/tests/CI/README/records. Ignored local DS_Store files were excluded.
- Repeated attacker/integration review addressed dangling links, mandatory resource, CIMD/private-key claims/JWKS/replay/audiences, revoke ownership, DCR secrets/capacity, scopes, safe proxy/timeout retries, IP-family isolation, hostnames, reset generations, hash concurrency, process ownership, downstream secrets/HTTP, helper DoS, UI redaction, Tunnel/YAML/routing, downstream timeout, and summary continuation.
- Final clean npm ci added 120/audited 121; all recorded checks passed. After R-049, real CIMD was 10/10 HTTP 200 and parsed private_key_jwt; JWKS was 200 with RSA/RS256 2048-bit. Persistent Tunnel uptime is runtime state, not a prerequisite for source acceptance.
- Remaining work at that checkpoint: none.
