# A Simple MCP Weather Server written in Rust

A minimal MCP server that exposes US weather data from the [National Weather Service API](https://www.weather.gov/documentation/services-web-api) as two tools:

- `get_forecast` – get the forecast for a location (takes `latitude` and `longitude`)
- `get_alerts` – get active weather alerts for a US state (takes a two-letter state code)

This example accompanies the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial.

## Prerequisites

- Rust 1.88+ and Cargo

## Build and run

```bash
cargo build --release
./target/release/weather
```

Or, during development:

```bash
cargo run
```

The server communicates over stdio, so running it directly just waits for a client on stdin. To see it in action, launch it from one of the client examples in this repository, for example:

```bash
cd ../mcp-client-rust
cargo run -- ../weather-server-rust/target/release/weather
```

## Tool annotations

Both tools declare the same [annotations](https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations): `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`. They tell a host that the tools only read data, and that they read it from an outside service (the NWS API), so a host can, for example, run them without asking the user to confirm each call. Annotations are hints, not guarantees: a host should rely on them only for servers it trusts.

## Structured content

Both tools declare an `output_schema` and return `structured_content`, and both return an object: `get_alerts` returns `{"alerts": [...]}`, with an empty list when there are none.

Revision `2026-07-28` is the first to allow a top-level array as the root of an output schema (see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec), but `2025-11-25` and earlier require an object, and that is still the revision most clients negotiate. rmcp sends an array schema as written on every connection rather than converting it, and an older client rejects it. So all five servers wrap the list in an object, and a `2025-11-25` client sees the same `get_alerts` as a `2026-07-28` one. They can return a bare array once every SDK converts it for older clients; see [#272](https://github.com/modelcontextprotocol/quickstart-resources/issues/272).
