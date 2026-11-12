# Technical Decision Records

Historical decisions from the OAuth/security hardening work begun on 2026-08-07. Accepted unless explicitly superseded. These describe decisions at the time; they are not a new audit of the current release.

## ADR-001: Built-in single-user OAuth Authorization Server

Accepted 2026-08-07. codex-mcp hosts its own AS and authenticates through one administrator password. The user explicitly chose built-in OAuth; a personal single-machine service needs no multi-user IAM. The project therefore owns authorization codes, PKCE, token lifecycles, metadata, password storage, rate limits, and OAuth tests.

## ADR-002: Opaque tokens rather than JWTs

Access/refresh tokens are high-entropy random opaque values; disk stores only SHA-256 digests and metadata. AS and RS share a process/machine, so self-contained JWT verification adds key/JWKS/rotation management without scaling benefits. Access: 15 minutes; authorization code: five minutes, one use; refresh: 30-day idle lifetime with rotation/reuse detection.

## ADR-003: Prefer CIMD, retain DCR fallback

AS metadata advertises CIMD; HTTPS URL client IDs use Client ID Metadata Documents. Standard /register remains for DCR compatibility. The 2026-07-28 MCP direction deprecated DCR, but existing clients cannot all be cut off immediately.

## ADR-004: Mandatory public OAuth, local debugging exception

Normal serving with a public domain requires authentication. --local forces 127.0.0.1 and permits noauth for Inspector/tests, preserving debugging while eliminating public unauthenticated execution.

## ADR-005: Retain existing MCP transport

Do not combine the initial hardening with the separate breaking migration to the 2026-07-28 stateless core. OAuth plus full security remediation already has a broad regression surface. Later transport changes are recorded separately in ADR-029.

## ADR-006: Shared safe HTTP infrastructure

Use one safe-fetch layer for webfetch and CIMD: DNS/IP policy, private/link-local/loopback denial, manual redirects checked at every hop, streaming byte limits, and timeouts. Shared policy avoids drift between equivalent SSRF boundaries.

## ADR-007: Isolate Cloudflare configuration

Manage ~/.codex-mcp/cloudflared.yml without rewriting global ~/.cloudflared/config.yml. This avoids damaging other tunnels/ingress; the sidecar already supports an explicit --config path.

## ADR-008: Truthful risk metadata

Do not mark destructive tools non-destructive to reduce host confirmations. Shell/downstream proxies also advertise open-world risk. Metadata describes real capabilities; the host owns approval UX.

## ADR-009: Inject security schemes centrally per server

Public tools/list advertises OAuth2 mcp:tools; local advertises noauth. Inject schemes according to config.oauthRequired into each McpServer, not statically into each tool. Coexisting local/public servers must match their actual HTTP boundary.

## ADR-010: Automatic downstream instructions trust local keys only

Initialize instructions use only local mcp.json keys, not remote instructions/title/description/name. Remote schemas/descriptions enter model context only through explicit mcp_tools. Self-reported metadata is untrusted and need not expand initialize-time injection exposure.

## ADR-011: Bind DCR credentials to issuer

Persist the registration-time issuer and return clients only for the current issuer. Cap persisted DCR clients at 256. This binds credentials to their AS and prevents unlimited anonymous state growth.

## ADR-012: Typecheck production and test TypeScript

The historical implementation added tsconfig.test.json and checked src plus test TypeScript. tsx execution alone does not perform static checking; security regressions should also satisfy the type system.

## ADR-013: Enforce MCP OAuth constraints above SDK 1.30

Although generic SDK schemas make resource optional, authorization, code exchange, and refresh must explicitly match the current MCP resource. CIMD must contain client_id exactly matching its URL, a nonempty client_name, HTTPS or loopback HTTP redirects, and only supported/advertised none or private_key_jwt authentication. The application owns these profile constraints. Display complete redirect URI/host and a loopback impersonation warning.

## ADR-014: Revocation belongs to the authenticated client

/revoke affects only access/refresh tokens owned by the authenticated client_id. A different client receives standard idempotent success without revoking another client's token family. This prevents cross-client denial of service.

## ADR-015: Public-only DCR; public-key confidential CIMD

Accepted, revised after real ChatGPT integration on 2026-08-07. DCR accepts only token_endpoint_auth_method=none and generates/stores no client_secret. HTTPS CIMD additionally supports private_key_jwt using published RS256 public JWKS, never shared secrets. Keep per-client/global registration limits; at 256 clients, evict only the oldest inactive client outside the protection window with no active code/access/refresh. ChatGPT genuinely uses private_key_jwt; implementing public-key authentication is preferable to downgrading it or adding static secrets.

## ADR-016: No implicit scope expansion

Explicit authorization/refresh scopes must include mcp:tools; do not silently insert it. Refresh uses normalized scopes constrained to the original grant. An AS must not expand requested permissions or issue unusable combinations.

## ADR-017: Public network targets must be globally routable

Beyond private/loopback/link-local, deny special IPv6 NAT64, Teredo, ORCHID, benchmark, 6to4, documentation, and site-local prefixes. Separate IPv4/IPv6 BlockLists avoid Node cross-family false positives. Public MCP domains undergo strict DNS normalization, rejecting IPs, localhost, credentials, and invalid labels. Prefer an allow-policy of global routability to an incomplete minimal denylist.

## ADR-018: Password reset rotates the OAuth credential epoch

Codes/access/refresh bind to an irreversible generation derived from the current Argon2id PHC hash. Every auth reset changes salt/hash/generation, immediately invalidating old grants without restart. Keeping old refresh grants for up to 30 days would contradict reset expectations.

## ADR-019: Bound password approval frequency and concurrency

POST /authorize permits at most two concurrent Argon2id verifications, plus per-client/global fixed-window limits. Argon2id's 64 MiB cost is intentional but otherwise permits memory amplification; concurrency gives a definite peak bound.

## ADR-020: Isolate MCP sessions/processes by authorization session

**Superseded by ADR-029.** Public Mcp-Session-Id belonged to its OAuth client_id; processes additionally belonged to individual MCP session scopes. Historical limits: eight globally, four per scope. Other scopes receive Unknown processId even for guessed IDs; transport close cleans its scope. A valid token must not grant access to another client's/session's state.

## ADR-021: No plaintext downstream secrets in mcp.json

Sensitive env/header keys (token, Authorization, secret, password, API/private key) require environment references such as ${ENV_VAR}; missing variables fail startup. Tighten Unix files to 0600. Remote downstreams require HTTPS, except loopback HTTP; reject URL credentials/fragments. Home files are still subject to backup/sync/accidental commits, and credentials must not travel over remote plaintext HTTP.

## ADR-022: Wall-clock/resource budgets for helpers and regex

Ripgrep probes/searches and cloudflared commands/sidecars use bounded output, timeouts, TERM→KILL. Without ripgrep, run JS regex in a Worker with a runtime cap. Pathological regex/binaries or ignored TERM must not monopolize tool calls, the main thread, or memory.

## ADR-023: Do not show risky raw parameters in MCP Apps UI

Show command length/hidden markers instead of shell command text. Strip URL username/password/query/fragment. Actual model tool calls retain their arguments, but visual cards must not duplicate bearer/API tokens or signed URLs.

## ADR-024: Strict CIMD private_key_jwt authentication

Advertise private_key_jwt and RS256. Require exactly one of jwks or HTTPS jwks_uri with public keys. Enforce iss=sub=client_id, a required unique jti, required short-lived exp, and optional validated iat. Under final RFC 7523/OpenID Core rules, aud accepts the exact AS issuer or token endpoint; arrays may contain only those trusted identities. Cache replay keys client_id+jti through assertion expiry, requiring nonempty bounded jti without a nonstandard minimum entropy/length. Accept verifiable RSA/RS256 public keys with modulus at least 2048; use bounded cache and rotation refresh. Token/revoke share the verifier, with custom handlers for gaps in SDK 1.30. Merely parsing an assertion or treating it as none would bypass authentication.

## ADR-025: Trusted proxy support preserves SSRF policy

Support standard HTTPS proxy variables and macOS static Secure Web Proxy. Resolve/validate all A/AAAA via fixed DoH independently of local DNS, then pin proxy CONNECT to validated global IPs while retaining original Host/SNI/certificate checks. Reuse bounded keep-alive agents; fail over across at most two validated IPs only for transport reset/errno or the exact application bounded-timeout error. TLS/certificate/HTTP-validation failures remain closed. Repeat policy per redirect; HTTP URLs do not take this path. Trusted startup proxy settings help when browsers work but direct Node DNS/HTTPS fails, without weakening SSRF.

## ADR-026: Prove Tunnel readiness end to end

Edge registration proves only connector availability, not hostname routing. Generate high-entropy per-start probe paths and independent responses. After sidecar readiness, require exact public-hostname proof; otherwise close server/sidecar. Proxied CNAME flattening hides UUIDs, and real DNS misrouting previously produced false ready status.

## ADR-027: Dynamic form-action callback origin

**Superseded by ADR-028.** Initially expanded form-action from self to self plus the validated redirect origin for Chrome OAuth 302 navigation. This fixed a definite CSP conflict but real ChatGPT remained unreliable; independent approve/pending state was not the best interaction structure.

## ADR-028: SDK-native GET/POST /authorize

Remove /oauth/approve and in-memory pending_id. GET renders the password form with SDK-validated response_type/client_id/redirect_uri/code_challenge/code_challenge_method/scope/state/resource hidden fields. POST returns directly to /authorize; SDK revalidates client, redirect, PKCE, and resource, then the provider checks the password, creates a code, and redirects directly. Keep default-src none, frame-ancestors none, base-uri none; omit form-action so browsers do not restrict the callback chain. The page has no scripts and a fixed /authorize action. This follows DevSpace's stable structure, removes an endpoint and one-time state, and preserves CIMD, private_key_jwt, PKCE, resource binding, and Argon2 limits.

## ADR-029: Request-scoped stateless public MCP transport

Move server HTTP to @modelcontextprotocol/server / node / express v2 and per-request createMcpHandler, retaining stateless fallback for 2025-era clients. Remove Mcp-Session-Id registry and transport-close business lifecycles. OAuth client_id remains the stable process owner/tool-policy identity. Acquire ProcessOwnerPool leases per request factory; release when request-scoped McpServer closes; retain owner processes through a grace period after the last lease so reconnects recover processId. Node AbortSignal propagates cancellation to transport; errors/early closes get separate diagnostics.

Real ChatGPT through Cloudflare could trigger context canceled across several tools, followed by persistent sessionful 502s while both origin/public healthz stayed 200 and local tool/OAuth/gateway tests passed. Request-scoped serving confines cancellation to one exchange rather than poisoning later requests with stale session IDs, while preserving long-lived process state by OAuth owner.
