# MCP Quickstart Smoke Tests

This directory contains smoke tests for the MCP quickstart examples. These tests verify that all example servers and clients can start and respond correctly.

## Overview

The smoke tests verify:

- **Servers**: Each weather server (Python, TypeScript, Rust, Go, Ruby) can start, respond to MCP protocol requests, and honour the output schemas it advertises
- **Clients**: Each MCP client (Python, TypeScript, Ruby, Go, Rust) can connect to a mock server and list tools
- **Tool loop**: Each client (Python, TypeScript, Ruby, Go, Rust) runs a query through a scripted tool-use loop against a fake Anthropic API and forwards tool results correctly

## Structured content

Listing tools is not enough to catch a broken structured result, so each server test also **calls** every tool that declares an `outputSchema` and checks the answer:

- the result must carry `structuredContent`, and it must conform to the declared schema (the SDK validates this and throws on a mismatch);
- a tool with an array-rooted schema must return a **top-level JSON array**, and one with an object-rooted schema must return an object.

The array case is the one worth guarding. A server that advertises `{"type": "array"}` and then answers `{"result": [...]}` passes a tools/list-only test and fails this one.

Tool calls reach the live NWS API. When it is unreachable the tools return an error result, which the test reports as a skip rather than a failure — someone else's outage should not fail the build.

## Tool loop

Connecting and listing tools does not exercise the chat loop, so each client is also driven through three scripted queries with `tool-loop-test.ts`. No real API is involved: the helper starts a fake Anthropic Messages API on a loopback port and hands it to the client through `ANTHROPIC_BASE_URL`, which every quickstart SDK reads. The client talks to the mock MCP server as in the no-key test. The helper types each query only after the client shows its `Query:` prompt, as a person would.

The fake API picks a script from the query text and checks every request the client sends:

- **parallel tools** — a response with two `tool_use` blocks, then one for a tool the mock server lacks, then an answer. `tools` must be passed on every call, `max_tokens` must be 10000 (room for the model's adaptive thinking), every `tool_use` must get a `tool_result` in a single following user message with matching `tool_use_id`s, and the MCP `isError` result must be forwarded as `is_error`.
- **ten tool turns** — exactly `MAX_TOOL_TURNS` tool calls, then an answer. The client must print the answer and no stop notice: nothing was cut short.
- **endless tool turns** — a tool call on every response. The client must stop after `MAX_TOOL_TURNS` rounds, print `[Stopped after 10 tool-use turns]` once, and make no further call.

Finally the client must exit 0 on `quit`. A client that does one tool round and stops, drops `tools` on the follow-up call, sends one `tool_result` per message, or gets the turn cap wrong passes the no-key test and fails this one.

All five clients are covered, including Rust: it calls the Messages API directly, so it honours `ANTHROPIC_BASE_URL` like the official SDKs do.

## Running Tests

```bash
./tests/smoke-test.sh
```

## Requirements

- **Node.js** 20+ (required by the 2.0 MCP SDK packages)
- **npm** (for Node.js dependencies)
- **Python** 3.10+
- **uv** (Python package manager)
- **Rust** stable
- **Cargo** (for Rust builds)
- **Go** 1.25+
- **Ruby** 3.4+ (3.2 and 3.3 satisfy the gems, but 3.2 is past end of life)
- **Bundler** (ships with Ruby 3.x)

## How It Works

### Server Tests

Each server test:

1. Builds/prepares the server if needed (a failed build prints its compiler output rather than swallowing it)
2. Uses `mcp-test-client.ts` to connect to the server via stdio
3. Negotiates a protocol era with `mode: "auto"` — one `server/discover` probe, falling back to the `2025-11-25` `initialize` handshake
4. Lists tools, then calls each tool that declares an `outputSchema` and checks the structured result against it
5. Reports pass/fail

### Client Tests

Each client test:

1. Builds/prepares the client if needed
2. Runs the client CLI without an ANTHROPIC_API_KEY
3. The client connects to a mock server, lists tools, and exits gracefully
4. Verifies the client can connect and communicate via MCP protocol
5. Reports pass/fail

**Note**: Client tests run the actual CLI programs without an Anthropic API key. The clients are designed to handle missing API keys gracefully by listing available tools and exiting, which is perfect for smoke testing the MCP connectivity without requiring external API calls.

The key is set to the empty string rather than unset. Every client loads `.env` without overriding variables already in the environment, so an empty value keeps a developer's local `.env` from starting the chat loop, and every client treats an empty key the same as a missing one.

## Test Helpers

### mcp-test-client.ts

A minimal MCP client that connects to a server, initializes the session, and lists available tools. Used to test servers without requiring a full client implementation.

**Usage**:

```bash
node tests/helpers/build/mcp-test-client.js <command> [args...]
```

**Example**:

```bash
node tests/helpers/build/mcp-test-client.js python weather.py
```

### mock-mcp-server.ts

A minimal MCP server that verifies clients call the `tools/list` method. Used to test clients without requiring a real weather server. Exits with an error if the client doesn't call `tools/list`.

It advertises two tools whose output schemas cover both shapes a structured result can take: an object root, and an array root. The array-rooted one is deliberate — a client that compiles every declared `outputSchema` up front, as the Go and Rust quickstart clients do, will fail here if it assumes an output schema is always `{"type": "object"}`.

**Usage**:

```bash
node tests/helpers/build/mock-mcp-server.js
```

### tool-loop-test.ts

Runs a client through the scripted tool loop described above. It starts the fake Anthropic API, spawns the client command with `ANTHROPIC_BASE_URL` and a dummy `ANTHROPIC_API_KEY` set, types the three queries and then `quit` at the client's prompts, and reports which checks failed along with the client's output.

**Usage**:

```bash
node tests/helpers/build/tool-loop-test.js <client command> [args...]
```

**Example**:

```bash
node tests/helpers/build/tool-loop-test.js node mcp-client-typescript/build/index.js tests/helpers/build/mock-mcp-server.js
```

## CI/CD Integration

Tests run automatically on pull requests via GitHub Actions. See `.github/workflows/ci.yml` for the CI configuration.

## Troubleshooting

### Dependencies missing

Install required dependencies:

```bash
# Python/uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Node.js (via nvm)
nvm install 24

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Ruby (via rbenv)
rbenv install 3.4
```

## Adding New Tests

To add a new test:

1. Add a new test function in `smoke-test.sh` (e.g., `test_new_feature()`)
2. Include dependency checks, builds, and test execution in the function
3. Add a `run_test` call in the "Run all tests" section
4. Update this README

## Maintenance

These tests are designed to be simple and low-maintenance:

- Shell scripts for orchestration (language-agnostic)
- Minimal TypeScript helpers for test infrastructure
- No external API dependencies
