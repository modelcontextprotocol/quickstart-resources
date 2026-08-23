# An LLM-Powered Chatbot MCP Client written in Ruby

An interactive chatbot MCP client: it launches an MCP server over stdio, lists its tools, and hands them to Claude, which can call them while answering your questions.

This example accompanies the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial.

## Prerequisites

- Ruby 3.4+ (3.3 also satisfies the gems)
- Bundler
- An [Anthropic API key](https://console.anthropic.com/) (optional — see below)

## Setup

Install the gems, then put your API key in a `.env` file (or export `ANTHROPIC_API_KEY` in your shell):

```bash
bundle install
cp .env.example .env
# then edit .env and add your key
```

## Run the client

Pass the path to a server script. `.rb` servers are launched with `ruby`, `.py` with `python3`, and `.js` with `node`:

```bash
bundle exec ruby client.rb ../weather-server-ruby/weather.rb
```

Type a question (for example, "What's the weather in Sacramento?") and Claude answers using the server's tools. Type `quit` to exit.

Without an `ANTHROPIC_API_KEY`, the client still connects, prints the server's tools, and exits — useful for verifying the MCP wiring without credentials.

## Structured content

The spec says clients SHOULD validate structured results against the schema the tool declares, and this SDK's client does not do it for you — `MCP::Client::Tool#output_schema` hands back the raw schema from the wire and nothing checks results against it. So the client compiles each declared schema once at connect time with `MCP::Tool::OutputSchema.new` and validates every non-error result.

The two channels go to different readers: `content` is forwarded to the model, while `structured_content` is used as data — when a tool returns an array, the client counts its items rather than re-reading the prose. See [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content).

`MCP::Client::Stdio` offers `2026-07-28` by default, so no negotiation setup is needed here.
