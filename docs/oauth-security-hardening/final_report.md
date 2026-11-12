# OAuth and Full Security Hardening Final Report

Date: 2026-08-07. **Historical report:** results below describe that remediation checkpoint, not the current English release or a current dependency audit. Later transport decisions are recorded in decisions.md, particularly ADR-029.

## Outcome

The original 28 findings and follow-up/real-integration R-029–R-052 were fixed: **52 / 52 fixed**. Public MCP changed from noauth to mandatory built-in OAuth. Local debugging forced 127.0.0.1 with accurate noauth metadata. Production code, tests, build, audit, and focused Node22 compatibility passed at that checkpoint. No commit was made because the user had not requested one.

## Security results

### 1. Public execution boundary

Previously, knowing the URL allowed shell execution. After remediation:

```text
Internet / ChatGPT
  ↓ OAuth discovery
Authorization Code + PKCE S256
  ↓ Administrator Argon2id password approval
Bearer access token (mcp:tools)
  ↓ /mcp
Coding tools
```

Unauthenticated MCP returns 401 plus the RFC 9728 resource metadata pointer.

### 2. OAuth

Implemented built-in single-user AS, auth CLI, Argon2id hashes, code/S256-only flow, RFC 9207 issuer identification, RFC 9728 metadata, and safe CIMD fetch. CIMD blocks private/loopback SSRF, requires exact URL-matching client_id/nonempty name, and permits only HTTPS or loopback HTTP redirects.

CIMD supports none and real ChatGPT private_key_jwt with advertised RS256, public JWKS, iss=sub=client_id, exact issuer/token-endpoint audiences without unrelated/mixed targets, required exp/jti, optional validated iat, and client_id+jti replay protection. Token/revoke share custom verification where SDK 1.30 lacks it. CIMD respects no-store/max-age up to 24h; JWKS has bounded caching/rotation refresh.

DCR remains public+PKCE without shared secrets, binds clients to issuer, caps storage at 256, limits registration to 10/hour/client and 100/day globally, and safely evicts only oldest inactive clients.

Codes/access/refresh are opaque; disk holds SHA-256 digests only. Codes last five minutes and are single-use; access lasts 15 minutes; refresh has a 30-day idle lifetime, rotation, and whole-family revocation on replay. Authorization/code/refresh explicitly require the matching resource. Explicit scopes require mcp:tools with no silent expansion. Revoke enforces client ownership.

Authorization displays full redirect host/URI and loopback warnings. Final interaction uses SDK-native GET/POST authorize, no approve/pending state, POST revalidation, direct callback, and no form-action directive; script/frame/base restrictions remain. Approval bounds: 12/15m/client, 60/15m globally, two concurrent hashes. CF-Connecting-IP is trusted only from loopback peers.

E2E covered incorrect PKCE, three missing-resource cases, no raw secret persistence, confidential DCR rejection, strict scopes, refresh replay/family revoke, cross-client revoke, immediate reset-generation invalidation without restart, and concurrent 429s. Private-key tests covered exchange/refresh/revoke, wrong audiences, missing/replayed/short unique jti. Real CIMD/JWKS fetch/parse succeeded.

### 3. Project roots

Lexical plus canonical containment blocks parent traversal, symlink/junction escape, dangling write-through, cycles, and new-target ancestor escapes. Real write regressions verified no outside target was created. This is a file-tool boundary, not an OS sandbox; authorized shell commands retain system-user permissions.

### 4. Network

webfetch/CIMD/JWKS share safe HTTP: private/loopback/link-local/reserved denial, separate IPv4/IPv6 lists, special IPv6 prefixes, direct DNS validation, manual per-hop redirect checks, streaming byte caps, timeouts, and no URL credentials.

Standard HTTPS_PROXY/ALL_PROXY/NO_PROXY and macOS static Secure Web Proxy are supported. Proxy HTTPS independently resolves/validates global A/AAAA through DoH, pins CONNECT to verified IPs, and retains original Host/SNI/cert checks. Bounded keep-alive plus limited validated-IP failover handles transport errno/reset/exact internal timeout only. HTTP URLs do not use this path. This fixed SSRF, post-buffer size checks, and browser-versus-Node connectivity differences.

### 5. Processes/resources

TERM→KILL handles shell timeout, ripgrep helpers, and cloudflared commands/sidecars. Regex fallback runs in a capped Worker. Bound output/scans, process trees, async shutdown, and process quotas prevent indefinite growth. Historical MCP sessions were capped at 32 and owned by OAuth client; processes at eight globally/four per session scope, foreign IDs inaccessible and transport-close cleanup enforced. Nonzero exec/stdin reports isError. Public end-to-end instance proof follows connector readiness and fails closed for misrouted DNS/Workers/old instances.

### 6. Cloudflare

Use private codex-mcp cloudflared config, not global config. Remote deletion and DNS overwrite require explicit confirmation. Reuse IDs only when exact remote name/ownership matches; exact text fallback avoids substring confusion; apostrophe-containing credential paths round-trip in YAML. Evolving lifecycle changes are tracked in the dedicated lifecycle document.

### 7. Downstream MCP

Sensitive config env/headers require environment references and fail on missing variables; Unix files tighten to 0600. Remote endpoints require HTTPS except loopback, without URL credentials/fragments. Parent instructions use local keys only, not remote metadata. Discovery returns the current catalog, reconnects on closed links, and uses a 60-second total initialize/reconnect budget while preserving independent parallel servers. Calls preserve complete content including images.

### 8. Metadata/UI

Public schemes advertise OAuth2 mcp:tools; local noauth. Writes/edits are destructive/local, shell/stdin destructive/open-world, process kill destructive/local, discovery read-only/open-world, downstream calls destructive/open-world. Cards are event-first with about ten seconds maximum fallback and stop on final results; hide raw commands and strip sensitive URL parts. Summary done=false requires nonempty next.

### 9. Windows

Preserve CRLF round-trips. Document interrupt as forced tree termination on Windows versus Unix SIGINT. Store absolute Unicode launcher paths in UTF-8 ps1; ASCII cmd shims only reference the relative launcher.

## Historical tests / CI

Added/strengthened oauth.e2e, security-regressions, tools.e2e, mcp-gateway.e2e, rich/disconnect fixtures, tsconfig.test, and CI. Node22 matrix: Ubuntu/macOS/Windows, install → typecheck → test → build; Linux production audit.

### Recorded Node 24.18.0 validation

| Check | Historical result |
|---|---|
| Official-registry npm ci | PASS, 120 added / 121 audited |
| Typecheck | PASS |
| Six test groups | PASS |
| Build | PASS |
| Production audit | Zero vulnerabilities then |
| git diff --check | PASS |
| Real CIMD fetch/parse | 10/10 HTTP 200, private_key_jwt |
| Real JWKS | HTTP 200, RSA/RS256 2048-bit |
| Final change/untracked review | PASS |

Six groups: user-mcp-config, tools.e2e, mcp-gateway.e2e, security-regressions, private-key-jwt, oauth.e2e.

Focused Node 22.23.2: source/test compilation and private-key/security/OAuth compatibility passed.

### Recorded dependency state

| Package | Version |
|---|---|
| @modelcontextprotocol/sdk | 1.30.0 |
| @hono/node-server | 2.1.0 |
| hono | 4.13.0 |
| @node-rs/argon2 | 2.0.2 |
| https-proxy-agent | 9.1.0 |
| jose | 6.2.8 |
| minimatch | 10.2.6 |

Historical audit: zero vulnerabilities; npmmirror URLs zero, npmjs URLs 164.

## Records and scope

review.md contains all 52 findings; task_plan.md all completed phases; progress.md the implementation/validation timeline; findings.md research; decisions.md ADRs.

This initial remediation did not combine a move from sessionful Streamable HTTP to the 2026-07-28 stateless core. That was a separate breaking interoperability migration; later work is documented separately. All remediation changes remained in the working tree without a commit, as requested at that time.
