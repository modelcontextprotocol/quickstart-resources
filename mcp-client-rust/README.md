# An LLM-Powered Chatbot MCP Client written in Rust

An interactive chatbot MCP client: it launches an MCP server over stdio, lists its tools, and hands them to Claude, which can call them while answering your questions.

This example accompanies the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial.

## Prerequisites

- Rust (stable) and Cargo
- An [Anthropic API key](https://console.anthropic.com/) (optional — see below)

## Setup

Export your API key, or put it in a `.env` file in this directory (the `.env` file is optional):

```bash
export ANTHROPIC_API_KEY=your-api-key-here
```

## Run the client

Pass the command that starts the server — a binary or a script — after `--`:

```bash
cargo run -- ../weather-server-rust/target/release/weather
```

(Build the server first with `cargo build --release` in its directory.)

Type a question (for example, "What's the weather in Sacramento?") and Claude answers using the server's tools. Type `quit` to exit.

Without an `ANTHROPIC_API_KEY`, the client still connects, prints the server's tools, and exits — useful for verifying the MCP wiring without credentials.

## Structured content

rmcp does not validate tool output, so this client compiles each declared `outputSchema` at connect time and checks results against it — the spec's client-side SHOULD. It uses the [`jsonschema`](https://docs.rs/jsonschema) crate, which rmcp's own documentation recommends.

The two channels go to different readers: `content` is forwarded to the model, while `structured_content` is used as data — the client counts the items it returns. See [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content).
