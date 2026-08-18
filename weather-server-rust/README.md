# A Simple MCP Weather Server written in Rust

See the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial for more information.

## Structured content

Both tools declare an `output_schema` and return `structured_content`. `get_forecast` returns an object; `get_alerts` returns a top-level JSON array, which protocol revision `2026-07-28` is the first to allow — see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec.

Note that an array-rooted schema requires a `2026-07-28` client: rmcp sends it as written on every connection rather than projecting it down, so an older client rejects the tool list.
