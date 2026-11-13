# A Simple MCP Weather Server written in Ruby

A minimal MCP server that exposes US weather data from the [National Weather Service API](https://www.weather.gov/documentation/services-web-api) as two tools:

- `get_forecast` – get the forecast for a location (takes `latitude` and `longitude`)
- `get_alerts` – get active weather alerts for a US state (takes a two-letter state code)

This example accompanies the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial.

## Prerequisites

- Ruby 3.4+
- Bundler

## Setup and run

```bash
bundle install
bundle exec ruby weather.rb
```

The server communicates over stdio, so running it directly just waits for a client on stdin. To see it in action, launch it from the Ruby client example in this repository:

```bash
cd ../mcp-client-ruby
bundle install
bundle exec ruby client.rb ruby ../weather-server-ruby/weather.rb
```

## Tool annotations

Both tools declare the same [annotations](https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations): `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`. They tell a host that the tools only read data, and that they read it from an outside service (the NWS API), so a host can, for example, run them without asking the user to confirm each call. Annotations are hints, not guarantees: a host should rely on them only for servers it trusts.

## Structured content

Both tools declare an `output_schema` and return `structured_content`, and both return an object: `get_alerts` returns `{"alerts": [...]}`, with an empty list when there are none.

Revision `2026-07-28` is the first to allow a top-level array as the root of an output schema (see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec), but `2025-11-25` and earlier require an object, and that is still the revision most clients negotiate. The gem sends an array schema as written rather than converting it, and an older client rejects it. So all five servers wrap the list in an object, and a `2025-11-25` client sees the same `get_alerts` as a `2026-07-28` one. They can return a bare array once every SDK converts it for older clients; see [#272](https://github.com/modelcontextprotocol/quickstart-resources/issues/272).

Because a tool that declares an `output_schema` MUST return conforming structured content, the failure paths return an error result rather than a bare text one — error results are exempt from that requirement. "No alerts" is an empty list, not an error.

The tools also return a human-readable `content` block, which the SDK leaves alone.

## Known limitation: strict `2026-07-28` clients reject this server

The `mcp` gem never emits the `resultType` field on results. The 2026-07-28 schema makes it mandatory — "Servers implementing this protocol version MUST include this field" — so a client that enforces the revision rejects every response, including `tools/list`, before it ever reaches the structured content.

There is no way to set it from user code: `MCP::Server` accepts `ttl_ms:` and `cache_scope:` for the SEP-2549 cache hints, but nothing for `resultType`. The gem's own client does not check the field, so the gap is invisible when a Ruby client talks to a Ruby server, and only appears cross-SDK.

Until the gem emits `resultType`, this example is verified only against the Ruby client.
