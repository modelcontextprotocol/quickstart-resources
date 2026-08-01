# An LLM-Powered Chatbot MCP Client written in TypeScript

See the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial for more information.

## Structured output

The SDK validates every result against the tool's declared `outputSchema`, so the spec's client-side SHOULD needs no code here.

The two channels go to different readers: `content` is forwarded to the model, while `structuredContent` is used as data — when a tool returns an array, the client counts its items rather than re-reading the prose. See [Structured Content](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content).

`versionNegotiation: { mode: 'auto' }` probes `server/discover` and falls back to the `2025-11-25` handshake; the SDK's default is `'legacy'`. See the [SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/).
