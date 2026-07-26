# An LLM-Powered Chatbot MCP Client written in Go

See the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial for more information.

## Structured output

The SDK does not validate tool output, so this client compiles each declared `outputSchema` at connect time and checks results against it — the spec's client-side SHOULD. It uses [`jsonschema-go`](https://pkg.go.dev/github.com/google/jsonschema-go/jsonschema), already an SDK dependency.

The two channels go to different readers: `Content` is forwarded to the model, while `StructuredContent` is used as data — the client counts the items it returns. See [Structured Content](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content).
