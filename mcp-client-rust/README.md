# An LLM-Powered Chatbot MCP Client written in Rust

See the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial for more information.

## Structured content

rmcp does not validate tool output, so this client compiles each declared `outputSchema` at connect time and checks results against it — the spec's client-side SHOULD. It uses the [`jsonschema`](https://docs.rs/jsonschema) crate, which rmcp's own documentation recommends.

The two channels go to different readers: `content` is forwarded to the model, while `structured_content` is used as data — the client counts the items it returns. See [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content).
