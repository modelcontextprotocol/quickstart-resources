# Security Notes (Quickstart Resources)

These examples are intentionally minimal and optimized for learning. Before using similar patterns in production, apply basic hardening.

## If You Expose An MCP Server Over A Network (HTTP/SSE/WebSocket)

- **Require authentication**: do not expose unauthenticated tool endpoints to the public internet.
- **Treat browsers as hostile**:
  - Do not use wildcard CORS (`Access-Control-Allow-Origin: *`) on authenticated endpoints.
  - Do not reflect `Origin` without allowlist validation.
  - Prefer an explicit origin allowlist.
- **Bound resource usage**:
  - Set an explicit maximum request body size.
  - Add timeouts to outbound requests.
  - Add rate limits (per user/token and/or per IP).
- **Avoid RCE primitives in tools**:
  - Avoid `eval` / dynamic code execution.
  - Avoid invoking a shell with attacker-controlled input (`exec`, `sh -c`, `shell=True`).
  - If you must run commands, enforce strict allowlists and pass arguments as arrays (no shell).
- **Don't leak secrets**: redact `Authorization`, cookies, and API keys from logs.

## Local-Only Usage

If you run these examples locally via stdio transports, your main risks are still:

- accidentally adding dangerous tools (filesystem/shell) without strict controls
- leaking secrets via logs or environment

When in doubt: keep tool capability narrow and add input validation.

