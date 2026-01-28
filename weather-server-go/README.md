# A Simple MCP Weather Server written in Go

See the [Quickstart](https://modelcontextprotocol.io/quickstart) tutorial for more information.

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
