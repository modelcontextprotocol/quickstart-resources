# A Simple MCP weather Server written in TypeScript

See the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial for more information.

## Structured output

Both tools declare an `outputSchema` and return `structuredContent`. `get-forecast` returns an object; `get-alerts` returns a top-level JSON array, which protocol revision `2026-07-28` is the first to allow — see [Structured Content](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content) in the spec.

`serveStdio` serves both protocol eras from one factory, and the SDK projects the array-rooted schema down to the `{"result": [...]}` form for a `2025-11-25` client, so adopting it costs older clients nothing. See the [SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/).
