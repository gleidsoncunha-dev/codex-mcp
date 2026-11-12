# Research Findings and Technical Notes

> Historical research recorded 2026-08-07. Execution decisions belong to task_plan.md and decisions.md. These notes describe the specifications and implementations reviewed then; they are not fresh verification of external standards.

## Standards baseline

The reviewed MCP 2026-07-28 core moved toward stateless serving without initialize/initialized/Mcp-Session-Id. The initial remediation deferred this separate compatibility migration. OAuth responses should include RFC 9207 iss; DCR was deprecated in favor of CIMD, with fallback retained for compatibility.

Metadata fetching is an SSRF boundary requiring private-network blocks, time/size budgets, schema and redirect validation. For a service where every coding tool is sensitive, use per-server HTTP authorization. Return 401 plus WWW-Authenticate pointing to RFC 9728 Protected Resource Metadata, not a tool-level error. AS metadata advertises endpoints, PKCE, and CIMD support.

## Confirmed review findings

### Critical / P0

1. Public Tunnel + noauth + shell allowed URL-only execution as the local user.
2. Deliberately false destructiveHint understated actual risk.
3. Lexical-only paths allowed symlink root escape; a temporary PoC wrote outside root.
4. The wizard overwrote global cloudflared config.
5. Missing local credentials triggered forced remote Tunnel deletion/recreation.
6. DNS conflicts silently used overwrite-dns and could take over hostnames.

### P1

- Local mode inherited 0.0.0.0 rather than guaranteeing loopback.
- 24-hour idle sessions had no count/rate cap; process manager lacked a process quota.
- String replacement interpreted replacement metacharacters rather than literal code.
- Read normalized CRLF while edit demanded exact disk text.
- Custom glob replacement reprocessed generated regex and broke deep globstars.
- Timeout/shutdown sent TERM without waiting/escalation, leaving hung children.
- Nonzero exec/stdin incorrectly reported success.
- webfetch buffered the full response before checking 5 MB and allowed private/redirect SSRF.
- Downstream gateway discarded valid image/resource/audio content.

### P2

- Immutable-catalog promise, remote instruction injection, and listTools without reconnect.
- Permanent 250ms iframe polling.
- Read limits applied only after full-file buffering; empty edit old_string permitted.
- Public healthz exposed projectRoot.
- Windows interrupt really used force tree kill despite Ctrl-C wording.
- ASCII launcher corrupted Unicode paths.
- Missing direct safety regression coverage and CI.

## Historical dependencies and baseline

The installed SDK was 1.30.0. Official audit identified moderate Hono 4.12.33 CORS ReDoS GHSA-8j4g-w8fx-2239 through the SDK; Express reduced reachability but the lock still needed updating. Many lock URLs used npmmirror, harming cross-region reproducibility.

Baseline: Node v24.18.0, npm 11.16.0, clean main...origin/main. After installing dependencies, typecheck/test/build passed.

## SDK 1.30 OAuth capabilities and limits

mcpAuthRouter provides AS metadata, authorize/token/register/revoke, endpoint rate limits, explicit issuer/resource/scopes, and resource metadata helpers. OAuthServerProvider supplies clientsStore, authorize, challenge lookup, code/refresh exchange, access verification, and optional revoke.

Authorize already enforces code/S256 and loads clients asynchronously. Non-loopback redirects match exactly; RFC 8252 loopback exceptions relax only the port, preserving scheme/host/path/query. Async client lookup can safely fetch unknown HTTPS CIMD client IDs and return virtual registered clients; DCR comes from persistent local storage.

SDK demo token stores are in-memory examples, not production persistence. The application still needs password login, rotation, and replay detection. Router paths are /authorize, /token, /register, /revoke. SDK createOAuthMetadata did not set CIMD support although its schema accepted it; mount custom SDK-derived metadata plus the flag ahead of protocol routes instead of forking handlers.

Token handlers check verifier/challenge, but provider code/client/redirect/resource matching and one-time consumption remain required. Public DCR can use none. Other default DCR clients receive 32-byte hex secrets, typically expiring after 30 days, so this project explicitly rejects that mode. Argon2 2.0.2 provides async Node22-compatible Argon2id hash/verify with explicit parameters and PHC output.

When CIMD is advertised, SDK clients use provider.clientMetadataUrl as client_id without DCR. Use standard InvalidGrant/Scope/Target/Token errors so expected client failures do not become 500s. requireBearerAuth parses bearer, verifies scopes/expiry, and includes resource_metadata in 401/403 challenges.

## Regression design

The echo fixture deliberately supplies Tiny echo MCP instructions and echo-fixture metadata. Parent descriptions/instructions should use only the local key, not remote instructions. Rich tools return image+text so protocol E2E proves preservation.

## Final standards/security review

- The MCP profile requires an explicit canonical resource in authorization and token requests. SDK generic optional schemas are insufficient; enforce it in authorization, code exchange, and refresh.
- CIMD must contain exact URL-matching client_id, nonempty client_name/redirect_uris, and validated HTTPS/loopback redirects. Display full redirect host/URI with loopback warning.
- SDK secret-free clients are otherwise treated as public, with no complete server-side private_key_jwt verifier. Real ChatGPT uses RS256/private_key_jwt/jwks_uri, so implement and advertise it rather than downgrade.
- Revoke must enforce authenticated client ownership to prevent cross-client family denial of service.
- DCR stays public-only without shared secrets. A cap alone permits slow registration DoS: add per-client/global limits and evict only oldest inactive clients outside protection windows with no live grants.
- Never silently add mcp:tools to explicit offline_access-only scopes; reject invalid scopes in authorization/refresh.
- Globally routable only: deny special IPv6 NAT64/discard/Teredo/ORCHID/benchmark/6to4/documentation/site-local, not just RFC1918.
- Domains feed issuer/resource/Host allowlists: canonicalize through WHATWG URL/IDN punycode, validate labels, reject IP/localhost/credentials/non-HTTP(S).
- Password reset rotates generations derived from PHC hash, invalidating old code/access/refresh even without restart. Argon2id costs 64 MiB; cap concurrent approvals at two.
- Bind historical MCP sessions to OAuth client_id. Guessed process IDs require independent scopes, shared capacity, scoped visibility, and cleanup. Later stateless ownership is documented in ADR-029.
- Require environment references for sensitive mcp.json keys, fail closed on missing env, Unix 0600, HTTPS except loopback.
- Put fallback regex in capped Workers; bound subprocess time/output and escalate TERM→KILL.
- Redact command text and URL credentials/query/fragment from UI metadata to avoid duplicating tokens/signed URLs.

## Real ChatGPT integration findings

Actual client IDs used https://chatgpt.com/oauth/<id>/client.json with private_key_jwt/RS256 and https://chatgpt.com/oauth/jwks.json. Invalid_client was incompatible client-auth policy, not a password problem.

OpenID private_key_jwt requires iss=sub=client_id, exp/jti; iat is optional. Generic RFC 7523 jti optionality does not apply to this profile. Follow final RFC/OpenID audience rules: exact issuer or token endpoint; arrays cannot mix unrelated targets. An issuer-only draft interpretation broke real token exchange. Replay cache keys client_id+jti through exp plus tolerance; token/revoke share verification.

Browser reachability does not imply direct Node connectivity. The reviewed Mac used Secure Web Proxy 127.0.0.1:7897 while direct DNS/HTTPS was disrupted. Safe HTTPS proxy support independently resolves through DoH, validates all addresses, pins CONNECT, and retains original Host/SNI/certificate checks. Use bounded keep-alive and at most two validated-IP retries for transport faults, including exact Request timed out after <n>ms without errno. Real CIMD then returned 10/10 HTTP 200. TLS/certificate/HTTP validation errors never retry; HTTP does not use this proxy path.

Mixed IPv4/IPv6 Node BlockLists incorrectly blocked public Cloudflare 172.64.155.209. Separate families and add regression coverage.

Registered tunnel connection only proves edge registration. Proxied CNAME flattening obscures UUIDs; a per-process random public probe proves actual instance routing.

Chrome applies form-action to cross-origin 302s after form submission. Old approve/pending flow issued codes without completing callbacks; dynamic callback origins remained unreliable. SDK-native authorize GET/POST, full hidden fields, POST revalidation, no pending state, and no form-action directive resolved the structure.

## References recorded at the time

- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://apps.extensions.modelcontextprotocol.io/api/documents/authorization.html
- https://blog.modelcontextprotocol.io/posts/client_registration/
- RFC 9728 Protected Resource Metadata; RFC 7636 PKCE; RFC 9207 Issuer Identification; RFC 9700 Security BCP.
- OpenID Connect Core 1.0, errata set 2: private_key_jwt claim requirements.
- OpenID Foundation 2025/2026 audience-hardening notice (issuer-identifier audience).
