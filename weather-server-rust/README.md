# A Simple MCP Weather Server written in Rust

A minimal MCP server that exposes US weather data from the [National Weather Service API](https://www.weather.gov/documentation/services-web-api) as two tools:

- `get_forecast` – get the forecast for a location (takes `latitude` and `longitude`)
- `get_alerts` – get active weather alerts for a US state (takes a two-letter state code)

This example accompanies the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial.

## Prerequisites

- Rust (stable) and Cargo

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

## Structured content

Both tools declare an `output_schema` and return `structured_content`. `get_forecast` returns an object; `get_alerts` returns a top-level JSON array, which protocol revision `2026-07-28` is the first to allow — see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec.

Note that an array-rooted schema requires a `2026-07-28` client: rmcp sends it as written on every connection rather than projecting it down, so an older client rejects the tool list.
