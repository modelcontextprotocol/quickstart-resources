# An LLM-Powered Chatbot MCP Client written in Ruby

See the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial for more information.

## Structured content

The spec says clients SHOULD validate structured results against the schema the tool declares, and this SDK's client does not do it for you — `MCP::Client::Tool#output_schema` hands back the raw schema from the wire and nothing checks results against it. So the client compiles each declared schema once at connect time with `MCP::Tool::OutputSchema.new` and validates every non-error result.

The two channels go to different readers: `content` is forwarded to the model, while `structured_content` is used as data — when a tool returns an array, the client counts its items rather than re-reading the prose. See [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content).

`MCP::Client::Stdio` offers `2026-07-28` by default, so no negotiation setup is needed here.
