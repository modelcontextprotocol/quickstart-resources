# An LLM-Powered Chatbot MCP Client written in Rust

An interactive chatbot MCP client: it launches an MCP server over stdio, lists its tools, and hands them to Claude, which can call them while answering your questions.

This example accompanies the [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) tutorial.

## Prerequisites

- Rust 1.88+ and Cargo
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

Type a question (for example, "What's the weather in Sacramento?") and Claude answers using the server's tools. The client keeps the conversation for the whole session, so a follow-up such as "And the alerts for that state?" works. Type `clear` to start a new conversation, or `quit` to exit.

Without an `ANTHROPIC_API_KEY`, the client still connects, prints the server's tools, and exits — useful for verifying the MCP wiring without credentials.

## Talking to Claude

There is no official Anthropic SDK for Rust, so this client calls the [Messages API](https://docs.anthropic.com/en/api/messages) over HTTP with `reqwest`. That keeps the request shape visible, and it means an assistant turn can be fed back exactly as it arrived. Claude requires that: the blocks it sends must return unchanged on the next request, a thinking block's `signature` included, and a wrapper type that models only text and tool calls would drop the rest.

`ANTHROPIC_BASE_URL` overrides the endpoint, as it does in the official SDKs for the other languages.

## Protocol negotiation

rmcp's `serve` only performs the legacy `2025-11-25` `initialize` handshake, so this client uses `serve_with_lifecycle` with `ClientLifecycleMode::Auto` instead: one `server/discover` probe for `2026-07-28`, falling back to `initialize`. Matching the Python and TypeScript clients' `auto` mode, it also makes this era's features reachable — an array-rooted `outputSchema`, for one, which `get_alerts` uses. The negotiated revision is printed on connect.

## Structured content

rmcp does not validate tool output, so this client compiles each declared `outputSchema` at connect time and checks results against it — the spec's client-side SHOULD. It uses the [`jsonschema`](https://docs.rs/jsonschema) crate, which rmcp's own documentation recommends.

The two channels go to different readers: `content` is forwarded to the model, while `structured_content` is used as data — the client counts the items it returns. See [Structured Content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content).

Before a tool result goes to the model, the client converts it to the Messages API's block types. Text stays text, a PNG, JPEG, GIF or WebP image becomes an image block, and a text resource becomes its text. Anything else, such as audio, becomes a placeholder like `[unsupported result type: audio]`, so the model knows something was there. Empty text is dropped, because the Messages API rejects empty text blocks. A result with structured content and no text is sent as its JSON. A call the server rejects goes back to the model as a failed tool result, so it can correct itself, rather than ending the query.

Every request sends the same short system prompt. When a reply stops early, the client says so: `[Reply cut off at the max_tokens limit]` when it ran out of tokens, and `[The model declined to answer; the query is not kept in history]` when the model refused. A reply that was cut off, refused or stopped at the tool-turn limit is not added to the history, so the next request stays valid.
