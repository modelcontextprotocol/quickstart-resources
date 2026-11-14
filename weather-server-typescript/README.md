# A Simple MCP Weather Server written in TypeScript

A minimal MCP server that exposes US weather data from the [National Weather Service API](https://www.weather.gov/documentation/services-web-api) as two tools:

- `get-forecast` – get the forecast for a location (takes `latitude` and `longitude`)
- `get-alerts` – get active weather alerts for a US state (takes a two-letter state code)

This example accompanies the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial.

## Prerequisites

- Node.js 24+
- npm

## Build and run

```bash
npm install
npm run build
node build/index.js
```

The server communicates over stdio, so running it directly just waits for a client on stdin. To see it in action, launch it from one of the client examples in this repository, for example:

```bash
cd ../mcp-client-typescript
npm install && npm run build
node build/index.js node ../weather-server-typescript/build/index.js
```

## Tool annotations

Both tools declare the same [annotations](https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations): `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`. They tell a host that the tools only read data, and that they read it from an outside service (the NWS API), so a host can, for example, run them without asking the user to confirm each call. Annotations are hints, not guarantees: a host should rely on them only for servers it trusts.

## Structured content

Both tools declare an `outputSchema` and return `structuredContent`, and both return an object: `get-alerts` returns `{"alerts": [...]}`, with an empty list when there are none.

Revision `2026-07-28` is the first to allow a top-level array as the root of an output schema (see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec), but `2025-11-25` and earlier require an object, and that is still the revision most clients negotiate. This SDK would cope with an array: it wraps one as `{"result": [...]}` for a `2025-11-25` client. The other four SDKs send it as written, which older clients reject, and the five examples should behave the same. So all five servers wrap the list in an object, and a `2025-11-25` client sees the same `get_alerts` as a `2026-07-28` one. They can return a bare array once every SDK converts it for older clients; see [#272](https://github.com/modelcontextprotocol/quickstart-resources/issues/272).

`serveStdio` serves both protocol eras from one factory. See the [SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/).
