# A Simple MCP Weather Server written in Go

A minimal MCP server that exposes US weather data from the [National Weather Service API](https://www.weather.gov/documentation/services-web-api) as two tools:

- `get_forecast` – get the forecast for a location (takes `latitude` and `longitude`)
- `get_alerts` – get active weather alerts for a US state (takes a two-letter state code)

This example accompanies the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial.

## Prerequisites

- Go 1.25+

## Build and run

```bash
go build -o weather
./weather
```

The server communicates over stdio, so running it directly just waits for a client on stdin. To see it in action, launch it from one of the client examples in this repository, for example:

```bash
cd ../mcp-client-go
go run main.go ../weather-server-go/weather
```

## Structured content

Both tools advertise an `outputSchema` and return `StructuredContent`. `get_forecast` returns an object; `get_alerts` returns a top-level JSON array, which protocol revision `2026-07-28` is the first to allow — see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec.

`get_forecast` sets no `OutputSchema` on the `Tool`: the SDK infers one from the handler's return type, which is the idiomatic Go spelling. `get_alerts` overrides it, because inference widens a slice to `["null", "array"]` — a nil slice marshals to `null` — and the tool never returns nil.

Note that an array-rooted schema requires a `2026-07-28` client: the SDK sends it as written on every connection rather than projecting it down, so an older client rejects the tool list.
