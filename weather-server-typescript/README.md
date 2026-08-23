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
node build/index.js ../weather-server-typescript/build/index.js
```

## Structured content

Both tools declare an `outputSchema` and return `structuredContent`. `get-forecast` returns an object; `get-alerts` returns a top-level JSON array, which protocol revision `2026-07-28` is the first to allow — see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec.

`serveStdio` serves both protocol eras from one factory, and the SDK projects the array-rooted schema down to the `{"result": [...]}` form for a `2025-11-25` client, so adopting it costs older clients nothing. See the [SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/).
