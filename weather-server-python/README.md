# A Simple MCP Weather Server written in Python

See the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial for more information.

## Structured output

Both tools declare an output schema and return `structured_content`. `get_forecast` returns an object; `get_alerts` returns a top-level JSON array, which protocol revision `2026-07-28` is the first to allow — see [Structured Content](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content) in the spec.

`Alerts` is a `RootModel[list[Alert]]` rather than a plain `list[Alert]` because the SDK wraps non-object return types as `{"result": ...}`; a `RootModel` is taken as the schema exactly as written. See [Structured Output](https://py.sdk.modelcontextprotocol.io/v2/servers/structured-output/) in the SDK docs.

Note that an array-rooted schema requires a `2026-07-28` client. This SDK does not project it down for older ones — it raises instead.
