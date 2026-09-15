# MCP Quickstart Resources

Example servers and clients for the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), in five languages. These are companion examples for two official tutorials:

- [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) – a simple MCP weather server exposing two tools backed by the US National Weather Service API
- [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client) – an LLM-powered chatbot MCP client that connects to any stdio server and lets Claude call its tools

## What's in this repository

Each example lives in its own directory with its own README covering prerequisites, setup, and how to run it:

| Language   | Weather server (MCP server)                                | Chatbot (MCP client)                               |
|------------|------------------------------------------------------------|----------------------------------------------------|
| Python     | [`weather-server-python`](./weather-server-python)         | [`mcp-client-python`](./mcp-client-python)         |
| TypeScript | [`weather-server-typescript`](./weather-server-typescript) | [`mcp-client-typescript`](./mcp-client-typescript) |
| Go         | [`weather-server-go`](./weather-server-go)                 | [`mcp-client-go`](./mcp-client-go)                 |
| Rust       | [`weather-server-rust`](./weather-server-rust)             | [`mcp-client-rust`](./mcp-client-rust)             |
| Ruby       | [`weather-server-ruby`](./weather-server-ruby)             | [`mcp-client-ruby`](./mcp-client-ruby)             |

All servers communicate over stdio and expose the same two tools: `get_forecast` and `get_alerts` (or `get-forecast` and `get-alerts` in TypeScript).

All clients launch a server, list its tools, and start an interactive chat loop in which Claude can call those tools. The Python, TypeScript, and Ruby clients take a path to a server script; the Go and Rust clients take the command to run, plus any arguments.

Note: These example clients need an `ANTHROPIC_API_KEY` to operate. Without a key, each client still connects and lists the server's tools before exiting, so you can verify the MCP wiring without credentials.

You can mix and match across languages: for example, the Python client can drive the TypeScript server. Each client's README lists which server launch forms it supports.

The [`tests`](./tests) directory contains the smoke tests that run in CI against these examples. See [`tests/README.md`](./tests/README.md) for how they work.

## Prerequisites

Each example only needs its own language toolchain. To work across the whole repository (for example, to run the smoke tests) you need:

- **Node.js** 24+ and **npm**
- **Python** 3.10+ and **uv**
- **Go** 1.25+
- **Rust** 1.88+ and **Cargo**
- **Ruby** 3.4+ and **Bundler**

## Running the tests

```bash
./tests/smoke-test.sh
```

The smoke tests verify that every server starts and answers MCP requests (including validating structured tool results against the schemas each tool advertises), and that every client can connect to a mock server and list tools. They run automatically on every pull request via GitHub Actions.

## Contributing

Contributions are welcome. To submit a change:

1. Fork the repository and create a branch from `main`.
2. Make your change. Keep the examples minimal - they exist to teach the protocol, not to be production services.
3. If you change an example's behavior, setup, or dependencies, update that example's README to match.
4. Run `./tests/smoke-test.sh` and make sure it passes.
5. Open a pull request against `main` describing what changed and why.

A few conventions to follow, in line with the broader [Model Context Protocol contributing guidelines](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/CONTRIBUTING.md):

- **Keep documentation clear, concise, and technically accurate.** Include code examples where appropriate, and test the commands and links you add.
- **Disclose AI assistance.** If you used any kind of AI assistance to prepare your contribution, say so in the pull request or issue. See [AI_POLICY.md](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/AI_POLICY.md) for what the disclosure should cover.
- **Be respectful.** This project follows the MCP community's [Code of Conduct](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/CODE_OF_CONDUCT.md). Concerns can be reported to mcp-coc@anthropic.com.

## Security note

These examples are intentionally minimal. If you expose an MCP server over a network (HTTP/SSE/WebSocket), add authentication and basic hardening (CORS allowlist, request size limits, timeouts, rate limits, and log redaction). See [`SECURITY.md`](./SECURITY.md).

## License

The MCP project is transitioning from the MIT License to Apache-2.0. New code contributions are licensed under Apache-2.0, and documentation (excluding specifications) under CC-BY-4.0. Earlier contributions whose authors have not consented to relicensing remain under the MIT License. See [`LICENSE`](./LICENSE) for the full terms.
