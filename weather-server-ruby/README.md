# A Simple MCP Weather Server written in Ruby

A minimal MCP server that exposes US weather data from the [National Weather Service API](https://www.weather.gov/documentation/services-web-api) as two tools:

- `get_forecast` – get the forecast for a location (takes `latitude` and `longitude`)
- `get_alerts` – get active weather alerts for a US state (takes a two-letter state code)

This example accompanies the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial.

## Prerequisites

- Ruby 3.4+ (3.3 also satisfies the gems)
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
bundle exec ruby client.rb ../weather-server-ruby/weather.rb
```

## Structured content

Both tools declare an `output_schema` and return `structured_content`. `get_forecast` returns an object; `get_alerts` returns a top-level JSON array, which protocol revision `2026-07-28` is the first to allow — see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec.

Declaring `type:` at the root of an `output_schema` is what makes the array case work. The SDK applies a `type: "object"` default only when the schema declares no root keyword, so `output_schema(type: "array", items: {...})` is taken as written.

Because a tool that declares an `output_schema` MUST return conforming structured content, the failure paths return an error result rather than a bare text one — error results are exempt from that requirement. "No alerts" is an empty array, not an error.

The tools also return a human-readable `content` block. When you pass your own `content`, the SDK leaves it alone; if you omit it entirely, the SDK serializes non-object structured content into a text block for you.

## Known limitation: strict `2026-07-28` clients reject this server

The `mcp` gem never emits the `resultType` field on results. The 2026-07-28 schema makes it mandatory — "Servers implementing this protocol version MUST include this field" — so a client that enforces the revision rejects every response, including `tools/list`, before it ever reaches the structured content.

There is no way to set it from user code: `MCP::Server` accepts `ttl_ms:` and `cache_scope:` for the SEP-2549 cache hints, but nothing for `resultType`. The gem's own client does not check the field, so the gap is invisible when a Ruby client talks to a Ruby server, and only appears cross-SDK.

Until the gem emits `resultType`, this example is verified only against the Ruby client. Note also that an array-rooted schema requires a `2026-07-28` client regardless: the gem sends it as written rather than projecting it down, so a `2025-11-25` client rejects the tool list.
