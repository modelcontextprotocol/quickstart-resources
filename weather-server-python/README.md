# A Simple MCP Weather Server written in Python

A minimal MCP server that exposes US weather data from the [National Weather Service API](https://www.weather.gov/documentation/services-web-api) as two tools:

- `get_forecast` – get the forecast for a location (takes `latitude` and `longitude`)
- `get_alerts` – get active weather alerts for a US state (takes a two-letter state code)

This example accompanies the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) tutorial.

## Prerequisites

- Python 3.10+
- [uv](https://docs.astral.sh/uv/)

## Run the server

```bash
uv run weather.py
```

`uv run` creates the virtual environment and installs dependencies on first use.

The server communicates over stdio, so running it directly just waits for a client on stdin. To see it in action, launch it from one of the client examples in this repository, for example:

```bash
cd ../mcp-client-python
uv run client.py ../weather-server-python/weather.py
```

## Structured content

Both tools declare an output schema and return `structured_content`. `get_forecast` returns an object; `get_alerts` returns a top-level JSON array, which protocol revision `2026-07-28` is the first to allow — see [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) in the spec.

`Alerts` is a `RootModel[list[Alert]]` rather than a plain `list[Alert]` because the SDK wraps non-object return types as `{"result": ...}`; a `RootModel` is taken as the schema exactly as written. See [Structured Output](https://py.sdk.modelcontextprotocol.io/v2/servers/structured-output/) in the SDK docs.

Note that an array-rooted schema requires a `2026-07-28` client. This SDK does not project it down for older ones — it raises instead.
