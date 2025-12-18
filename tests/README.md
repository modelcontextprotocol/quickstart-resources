# MCP Quickstart Smoke Tests

This directory contains smoke tests for the MCP quickstart examples. These tests verify that all example servers and clients can start and respond correctly, without calling external APIs.

## Overview

The smoke tests verify:

- **Servers**: Each weather server (Python, TypeScript, Rust) can start and respond to MCP protocol requests
- **Clients**: Each MCP client (Python, TypeScript) can connect to a mock server and list tools

## Running Tests

```bash
./tests/smoke-test.sh
```

## Requirements

- **Node.js** 16+
- **npm** (for Node.js dependencies)
- **Python** 3.10+
- **uv** (Python package manager)
- **Rust** stable
- **Cargo** (for Rust builds)

## How It Works

### Server Tests

Each server test:

1. Builds/prepares the server if needed
2. Uses `mcp-test-client.ts` to connect to the server via stdio
3. Sends MCP initialize and `tools/list` requests
4. Verifies the server responds with a valid tool list
5. Reports pass/fail

### Client Tests

Each client test:

1. Builds/prepares the client if needed
2. Runs the client CLI without an ANTHROPIC_API_KEY
3. The client connects to a mock server, lists tools, and exits gracefully
4. Verifies the client can connect and communicate via MCP protocol
5. Reports pass/fail

**Note**: Client tests run the actual CLI programs without an Anthropic API key. The clients are designed to handle missing API keys gracefully by listing available tools and exiting, which is perfect for smoke testing the MCP connectivity without requiring external API calls.

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

A minimal MCP server that verifies clients call the `tools/list` method and returns an empty tool list. Used to test clients without requiring a real weather server. Exits with an error if the client doesn't call `tools/list`.

**Usage**:

```bash
node tests/helpers/build/mock-mcp-server.js
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
nvm install 18

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
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
