# An LLM-Powered Chatbot MCP Client written in Python

See the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial for more information.

## Structured output

`call_tool` validates every result against the tool's declared output schema, so the spec's client-side SHOULD needs no code here.

The two channels go to different readers: `content` is forwarded to the model, while `structured_content` is used as data — the client counts the items it returns. See [Structured Content](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content).

`Client(transport, mode="auto")` probes `server/discover` and falls back to the `2025-11-25` handshake; `client.protocol_version` reports which era you got. See [Protocol versions](https://py.sdk.modelcontextprotocol.io/v2/protocol-versions/).

Requires the `mcp` 2.0 prereleases, so `pyproject.toml` sets `[tool.uv] prerelease = "allow"`.
