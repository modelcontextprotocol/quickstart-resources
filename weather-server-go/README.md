# A Simple MCP Weather Server written in Go

See the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial for more information.

## Building

```bash
go build -o weather
```

## Running

```bash
./weather
```

The server will communicate via stdio and expose two MCP tools:
- `get_forecast` - Get weather forecast for a location (requires latitude and longitude)
- `get_alerts` - Get weather alerts for a US state (requires two-letter state code)

## Structured content

Both tools advertise an `outputSchema` and return `StructuredContent`. `get_forecast` returns an object; `get_alerts` returns a top-level JSON array, which protocol revision `2026-07-28` is the first to allow — see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec.

`get_forecast` sets no `OutputSchema` on the `Tool`: the SDK infers one from the handler's return type, which is the idiomatic Go spelling. `get_alerts` overrides it, because inference widens a slice to `["null", "array"]` — a nil slice marshals to `null` — and the tool never returns nil.

Note that an array-rooted schema requires a `2026-07-28` client: the SDK sends it as written on every connection rather than projecting it down, so an older client rejects the tool list.
