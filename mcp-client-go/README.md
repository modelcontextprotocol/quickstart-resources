# An LLM-Powered Chatbot MCP Client written in Go

An interactive chatbot MCP client: it launches an MCP server over stdio, lists its tools, and hands them to Claude, which can call them while answering your questions.

This example accompanies the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial.

## Prerequisites

- Go 1.25+
- An [Anthropic API key](https://console.anthropic.com/) (optional — see below)

## Setup

Put your API key in a `.env` file (or export `ANTHROPIC_API_KEY` in your shell — the `.env` file is optional):

```bash
cp .env.example .env
# then edit .env and add your key
```

## Run the client

Pass the command that starts the server — a binary or an interpreter plus its arguments:

```bash
go run main.go ../weather-server-go/weather
```

(Build the server first with `go build -o weather` in its directory.) Any server command works, for example the Python server:

```bash
go run main.go uv --directory ../weather-server-python run weather.py
```

Type a question (for example, "What's the weather in Sacramento?") and Claude answers using the server's tools. The client keeps the conversation for the whole session, so a follow-up such as "And the alerts for that state?" works. Type `clear` to start a new conversation, or `quit` to exit.

Without an `ANTHROPIC_API_KEY`, the client still connects, prints the server's tools, and exits — useful for verifying the MCP wiring without credentials.

## Structured content

The SDK does not validate tool output, so this client compiles each declared `outputSchema` at connect time and checks results against it — the spec's client-side SHOULD. It uses [`jsonschema-go`](https://pkg.go.dev/github.com/google/jsonschema-go/jsonschema), already an SDK dependency.

The two channels go to different readers: `Content` is forwarded to the model, while `StructuredContent` is used as data — the client counts the items it returns. See [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content).

Before a tool result goes to the model, the client converts it to the Messages API's block types. Text stays text, a PNG, JPEG, GIF or WebP image becomes an image block, and a text resource becomes its text. Anything else, such as audio, becomes a placeholder like `[unsupported result type: audio]`, so the model knows something was there. Empty text is dropped, because the Messages API rejects empty text blocks. A result with structured content and no text is sent as its JSON. A call the server rejects goes back to the model as a failed tool result, so it can correct itself, rather than ending the query.

Every request sends the same short system prompt. When a reply stops early, the client says so: `[Reply cut off at the max_tokens limit]` when it ran out of tokens, and `[The model declined to answer; the query is not kept in history]` when the model refused. A reply that was cut off, refused, empty or stopped at the tool-turn limit is not added to the history, and a query that fails with an error is dropped from it, so the next request stays valid.
