# Review Findings and Fix Tracking

> Historical snapshot, 2026-08-07. Test filenames/results refer to acceptance evidence from that work. Some historical suites were later removed, so these references do not guarantee current release coverage. Revalidate current source, typecheck, build, and isolated smoke. Historical fixed status is not a complete audit of today's release.

This is the final ledger from the full review. Evolving Tunnel entries were synchronized without reclassifying all historical findings.

| ID | Severity | Finding | Status | Fix / historical evidence |
|---|---|---|---|---|
| R-001 | Critical | Public noauth plus shell allowed RCE | fixed | oauthRequired=true, SDK bearer guard, refuse listen without password; OAuth E2E checks 401/PRM and authenticated tools |
| R-002 | Critical | Risk annotations understated destructive/open-world capabilities | fixed | Truthful write/edit/shell/stdin/process/downstream annotations; per-server public OAuth2/local noauth injection; descriptor E2E |
| R-003 | Critical | Symlink bypass of project root | fixed | Canonical containment for existing/new/dangling/cyclic paths; E2E directory links and real dangling write denied without creating outside target |
| R-004 | High | Global cloudflared config overwritten | fixed | Use ~/.codex-mcp/cloudflared.yml; path regression |
| R-005 | High | Missing credentials automatically deleted remote Tunnel | fixed | Keep same-name remote resource; create unique candidate; clean only newly created candidates without DNS references |
| R-006 | High | Automatic DNS overwrite | fixed | Explicit confirmation; exact snapshots; API cutover after connector readiness; concurrency-aware compensation/read-back |
| R-007 | High | Local mode could listen on 0.0.0.0 | fixed | Unconditional 127.0.0.1 in local config; regression with user wildcard host |
| R-008 | High | Unbounded sessions/processes | fixed | Historical 32 MCP sessions, initialize 60/15m/client, eight processes; over-cap tests |
| R-009 | High | Edit replacement interpreted metacharacters | fixed | Replacement callback preserves literal replacement text; special-character E2E |
| R-010 | High | CRLF read/edit incompatibility | fixed | Streaming read preserves LF/CRLF for exact edit matching; multiline E2E |
| R-011 | High | Deep globstar matching broken | fixed | minimatch replaces custom parser; deep/nested/deep.ts matches globstar |
| R-012 | High | Bash timeout lacked SIGKILL escalation | fixed | Unix TERM→2s→KILL; Windows tree kill; ignored-TERM bounded-exit test |
| R-013 | High | Shutdown could orphan children | fixed | Async manager shutdown and awaited HTTP close reuse escalation; process IDs disappear |
| R-014 | High | Nonzero exec/stdin reported success | fixed | isError=true for nonzero/signal, retaining structuredContent; exit-9 E2E |
| R-015 | High | webfetch buffered fully before 5MB check | fixed | Streaming byte count; Content-Length only early rejection; 1KB hard-cap test |
| R-016 | High | Direct/redirect SSRF | fixed | DNS/IP validation; block private/loopback/link-local/reserved; validate every redirect; IPv4/IPv6 and loopback rejection |
| R-017 | High | Rich downstream content lost | fixed | Forward original result.content; image+text gateway fixture |
| R-018 | Medium | False immutable-catalog guarantee | fixed | Remove once-per-server promise; list real tools each time without catalog cache |
| R-019 | Medium | Remote instructions injected into parent | fixed | Use only local server keys, never automatic remote metadata; malicious echo-fixture E2E |
| R-020 | Medium | listTools lacked reconnect | fixed | Reconnect/retry on closed connection; disconnect fixture followed by successful discovery |
| R-021 | Medium | Permanent 4Hz card polling | fixed | Event-first, at most 40×250ms fallback, stop on final/hidden; static bounded-attempt test |
| R-022 | Medium | Read limit did not limit I/O | fixed | createReadStream stops at requested lines/80k output; 120k single-line test remains below 81k |
| R-023 | Medium | Empty edit old_string | fixed | Nonempty schema and validation regression |
| R-024 | Medium | healthz exposed projectRoot | fixed | Exactly {ok:true}; precise assertion |
| R-025 | Medium | Windows interrupt documentation contradicted force kill | fixed | Unix SIGINT versus Windows forced process-tree termination explicitly documented/tested |
| R-026 | Medium | ASCII installer corrupted Unicode paths | fixed | UTF-8 ps1 holds absolute path; ASCII cmd uses relative launcher; Windows CI/structure test |
| R-027 | Medium | Production Hono advisory | fixed | Historical lock Hono 4.13.0; official production audit zero at that time |
| R-028 | Medium | Missing CI/security regressions | fixed | Node22 Ubuntu/macOS/Windows install/typecheck/test/build, Linux audit, src+test typecheck and safety coverage |
| R-029 | High | DCR persisted confidential client_secret | fixed | DCR public none only; reject default-secret/confidential metadata; state has no secret; CIMD public-key confidential auth separately supported |
| R-030 | Medium | Persistent registration-cap DoS | fixed | Global 100/day, client 10/hour, max 256; evict only protected-window-expired oldest inactive without live code/access/refresh; bounded-eviction test |
| R-031 | Medium | Missing special IPv6 SSRF ranges | fixed | Globally routable policy; NAT64/discard/Teredo/ORCHID/benchmark/6to4/documentation/site-local tests |
| R-032 | Medium | Silent scope expansion and unused refresh normalization | fixed | Require explicit mcp:tools, apply normalized refresh scope; offline_access-only authorization/refresh invalid_scope |
| R-033 | Medium | Loose public hostname validation | fixed | URL/IDN canonicalization; reject IP/localhost/credentials/non-HTTP(S)/invalid labels; config tests |
| R-034 | High | Password reset retained old grants | fixed | PHC-derived generations for code/access/refresh; same-password reset changes salt; verified-hash generation prevents reset race; running server rejects old access/refresh |
| R-035 | Medium | Concurrent Argon2 memory amplification | fixed | Two concurrent approvals plus client 12/15m/global 60/15m; five-request E2E includes 429 |
| R-036 | Medium | MCP sessions lacked OAuth ownership | fixed | ownerClientId checked on create/access; mismatches behave as unknown sessions; isolation regression |
| R-037 | High | Shared guessable process IDs enabled cross-session poll/kill | fixed | Eight globally, four per scope; scoped visibility, transport-close cleanup, global shutdown; foreign IDs return Unknown processId |
| R-038 | High | Plaintext downstream secrets/remote HTTP | fixed | Sensitive keys require environment references; missing env fails; Unix 0600; HTTPS except loopback; reject credentials/fragments; config tests |
| R-039 | Medium | Regex/helpers could hang or flood resources | fixed | Time/output budgets and TERM→KILL; JS regex Worker five-second cap; ignored-TERM and pathological-regex executable regressions |
| R-040 | Medium | Tool cards leaked raw commands/signed URLs | fixed | Command hidden/length only; strip URL credentials/query/fragment; assertions exclude bearer/access-token secrets |
| R-041 | Medium | Cached ID/name mismatch, substring Tunnel match, YAML quote loss | fixed | Match saved ID against exact remote name, exact text fallback, unescape doubled apostrophes; prod/name and path round-trip tests |
| R-042 | Low | Bad downstream initialize slowed all startup/reconnect | fixed | Explicit 60s timeout/maxTotalTimeout; retain error status while other downstreams connect in parallel |
| R-043 | Low | done=false summary allowed missing next | fixed | Return MCP error if continuation has no next step; tools E2E |
| R-044 | High | Real ChatGPT private_key_jwt unsupported by CIMD/SDK middleware | fixed | RS256 public JWKS, iss=sub, exp/jti, optional iat, shared custom token/revoke verifier; exchange/refresh/revoke/replay/missing-jti/wrong-aud tests and real fetch/parse |
| R-045 | High | Mac browser proxy worked while direct Node CIMD/JWKS failed | fixed | Standard/macOS proxy support; independent DoH global validation, IP-pinned CONNECT, original Host/SNI/cert, bounded keep-alive/transport failover; per-hop budgets retained; real fetch 200 |
| R-046 | Medium | Mixed BlockList families falsely blocked public IPv4 | fixed | Separate IPv4/IPv6 lists; regression for 172.64.155.209 plus all special IPv6 denials |
| R-047 | Medium | Edge/DNS command success did not prove hostname reached current Tunnel | fixed | Per-process random path/response; require exact public probe; stop sidecar/server on wrong Tunnel/Worker/old instance; positive/negative tests |
| R-048 | Medium | Generic RFC optional jti misapplied to OpenID profile | fixed | Required bounded nonempty jti, client_id+jti replay cache through expiry; missing/replay/short-unique tests, no nonstandard entropy minimum |
| R-049 | Medium | Internal bounded timeout lacked errno and skipped proxy fallback | fixed | Recognize exact Request timed out after <n>ms as retryable transport fault; keep certificate/HTTP validation fail-closed; real CIMD 10/10 200 |
| R-050 | High | Chrome form-action self blocked OAuth callback 302 | fixed | Final native flow omits form-action, retains default-src/frame-ancestors/base-uri none, no scripts and fixed authorize action |
| R-051 | High | Custom approve/pending lifecycle caused half-success and expired retries | fixed | Native authorize GET/POST, complete hidden parameters, POST SDK revalidation, direct callback, remove pending state; old endpoint 404, wrong password 401, throttle 429, correct 302/code/state/iss |
| R-052 | High | Issuer-only draft audience rejected real token-endpoint aud | fixed | Exact issuer or token endpoint; arrays may contain only these, reject mixed/unrelated; exchange/refresh/revoke and dual-audience tests |

## Additional OAuth acceptance (historical PASS)

| Area | Evidence |
|---|---|
| Code/PKCE | Wrong verifier 400 invalid_grant; correct verifier still redeemable |
| Resource metadata / issuer | 401 challenge with RFC 9728 pointer; exact RFC 9207 callback iss |
| CIMD | Advertised support, none/private_key_jwt, safe loopback rejection, exact ID/name/redirect validation, no-store/max-age cache up to 24h |
| Private-key auth | RS256 public RSA at least 2048; issuer/token audience; claim checks/replay; exchange/refresh/revoke and real CIMD/JWKS |
| DCR | Public-only registration/auth/refresh; no secret persistence; issuer binding; 256 cap, dual rate limit, safe eviction |
| Passwords/tokens | Argon2 PHC and digests only; reset invalidates old grants immediately |
| Resource/scope | Mandatory explicit resource in three phases; mcp:tools required; no implicit expansion |
| Refresh | Rotation and family revoke on replay; rotated access then receives 401 |
| Rate limits | CF-Connecting-IP trusted only from loopback; per-client/global/two concurrent hash bounds |
| Public startup | Refuse without password, never fall back to noauth |
| Revoke ownership | Foreign-client revoke is idempotent 200 but leaves the owner's access valid |
| Authorization UI | Full redirect/loopback warning; no approve/pending; script-free native authorize and callback-compatible CSP |
| Tunnel | Exact random public probe; wrong instance fails startup |
| Local | 127.0.0.1 only, HTTP noauth, matching tool metadata |

## Historical conclusion

The original 28 findings, follow-up R-029–R-043, and real-integration R-044–R-052 were all closed: **52 / 52 fixed**, no open findings at that review checkpoint.
