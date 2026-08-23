# An LLM-Powered Chatbot MCP Client written in Python

An interactive chatbot MCP client: it launches an MCP server over stdio, lists its tools, and hands them to Claude, which can call them while answering your questions.

This example accompanies the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial.

## Prerequisites

- Python 3.10+
- [uv](https://docs.astral.sh/uv/)
- An [Anthropic API key](https://console.anthropic.com/) (optional — see below)

## Setup

Put your API key in a `.env` file (or export `ANTHROPIC_API_KEY` in your shell):

```bash
cp .env.example .env
# then edit .env and add your key
```

## Run the client

Pass the path to a server script. `.py` servers are launched with `uv`, `.js` servers with `node`:

```bash
uv run client.py ../weather-server-python/weather.py
```

or, against the TypeScript server (build it first — see its README):

```bash
uv run client.py ../weather-server-typescript/build/index.js
```

Type a question (for example, "What's the weather in Sacramento?") and Claude answers using the server's tools. Type `quit` to exit.

Without an `ANTHROPIC_API_KEY`, the client still connects, prints the server's tools, and exits — useful for verifying the MCP wiring without credentials.

## Structured content

`call_tool` validates every result against the tool's declared output schema, so the spec's client-side SHOULD needs no code here.

The two channels go to different readers: `content` is forwarded to the model, while `structured_content` is used as data — when a tool returns an array, the client counts its items rather than re-reading the prose. See [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content).

`Client(transport, mode="auto")` probes `server/discover` and falls back to the `2025-11-25` handshake; `client.protocol_version` reports which era you got. See [Protocol versions](https://py.sdk.modelcontextprotocol.io/v2/protocol-versions/).
