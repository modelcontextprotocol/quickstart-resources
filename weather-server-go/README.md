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
go run . ../weather-server-go/weather
```

## Tool annotations

Both tools declare the same [annotations](https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations): `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`. They tell a host that the tools only read data, and that they read it from an outside service (the NWS API), so a host can, for example, run them without asking the user to confirm each call. Annotations are hints, not guarantees: a host should rely on them only for servers it trusts.

## Structured content

Both tools advertise an `outputSchema` and return `StructuredContent`, and both return an object: `get_alerts` returns `{"alerts": [...]}`, with an empty list when there are none.

Neither tool sets `OutputSchema` on the `Tool`: the SDK infers one from the handler's return type, which is the idiomatic Go spelling. Inference types a slice field as `["null", "array"]`, because a nil slice marshals to `null`; the handlers always build a non-nil slice, so the tools never send `null`.

Revision `2026-07-28` is the first to allow a top-level array as the root of an output schema (see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec), but `2025-11-25` and earlier require an object, and that is still the revision most clients negotiate. This SDK sends an array schema as written on every connection rather than converting it, and an older client rejects it. So all five servers wrap the list in an object, and a `2025-11-25` client sees the same `get_alerts` as a `2026-07-28` one. They can return a bare array once every SDK converts it for older clients; see [#272](https://github.com/modelcontextprotocol/quickstart-resources/issues/272).
