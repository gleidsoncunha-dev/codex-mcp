# Setup / Tunnel Lifecycle Design

## Goals

Give public configuration, Cloudflare resources, and daemon runtime state clear, unique owners. Configuration commands own interaction and mutations; checks remain read-only; daemon consumes only committed configuration.

Retain the single-daemon, multiple-project model. Public route verification has one 30-second budget and supports cancellation. Commands, compensation, and security boundaries have regression coverage.

## State boundaries

Public access has only two committed states:

- `external`: user-provided HTTPS endpoint; persist only the hostname.
- `cloudflare`: locally managed Tunnel owned by codex-mcp; persist hostname, Tunnel ID/name, cloudflared path, and account/zone identity.

Runtime intent is separate: local/public mode, managed sidecar startup, and Tunnel log mirroring. Daemon state must retain complete intent so restart and restoration after setup preserve semantics.

Cloudflare state consists of separate lifecycles:

- Account certificate: account-level management credentials; successful login is its own durable checkpoint.
- Tunnel credentials: permission to run one Tunnel, managed together with the remote Tunnel.
- Runtime YAML: artifact derived from committed configuration.
- Tunnel, DNS record, and connector: independent remote/runtime lifecycles.

## Command responsibilities

| Entry | Responsibility |
|---|---|
| `setup` → Check current configuration | Read-only inspection of committed config, runtime, and public instance |
| `setup` → Change public access | The public mutation entry point |
| `setup` | Public access configuration and changes |
| daemon start | Read committed config only; no prompts, login, or DNS changes |
| `status` | Present observed daemon/sidecar state and compare public/local instances |
| `doctor` | Read-only reconciliation of config, YAML, credentials, Tunnel, DNS, and connector by default; `--fix` only allowlisted local repairs (directories, stale daemon state), never DNS/OAuth/password/projects |

## Managed Tunnel setup order

```text
Acquire lifecycle lock
→ Identify port owner; fail on unknown use before any Cloudflare mutation
→ Keep the known daemon online
→ Login checkpoint / account and zone discovery
→ Build change plan
→ Create or reuse candidate Tunnel and credentials
→ Write candidate YAML
→ Briefly stop the known daemon only once the candidate is prepared
→ Start local random probe origin
→ Start candidate connector and wait for readiness
→ Snapshot previous DNS record through Cloudflare API
→ Switch DNS to candidate Tunnel
→ Verify public random probe within one 30-second budget; Ctrl+C immediately requests cancellation and compensation
→ Atomically commit local config and runtime YAML revision
→ Restore complete previous daemon intent
→ Compare local/public instance
```

Switch DNS only after the candidate connector is ready. Interactive login, zone/hostname selection, and candidate preparation must not interrupt a healthy daemon early. Downtime covers only origin/connector/DNS verification and commit. Configuration mutations must not reuse the read-only branch that compares an old daemon when the port is occupied.

## Failure and compensation

- Successful login is not deleted when a later route step fails.
- Save complete DNS records before changes; restore them on failure, or remove the new record if none existed previously.
- Automatically delete only Tunnels newly created in this session and not yet in use.
- Keep the previous committed config until final verification succeeds.
- Compensation failures must report the phase, completed remote changes, and exact recovery actions; never claim successful rollback.
- Ctrl+C during DNS mutation first marks cancellation, lets the current remote request settle, and enters the same compensation path instead of terminating immediately.

## Persistence

Use private temporary files, `0600`, and rename for config and runtime artifacts. YAML is a derived revision: write it completely before a single atomic config commit points to it. Clean the previous revision after successful switching.

Account switching uses a session-specific temporary HOME. Replace the old certificate only after parsing the new one and confirming its account.

## Runtime

Sidecar states: `off | starting | connected | degraded | exited`. Exits after readiness must propagate into daemon status. Daemon keeps its local control plane available and uses bounded backoff restarts for unexpected exits. Connections force IPv4 as an edge workaround without pinning transport: cloudflared `auto` chooses/falls back between QUIC and HTTP/2.

After starting the public server, managed Tunnel, custom HTTPS, and `--no-tunnel` all use the same random end-to-end probe to prove that the public hostname reaches the current instance.
