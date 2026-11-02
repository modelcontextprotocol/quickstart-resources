# AGENTS.md

Guidance for anyone changing these examples, human or agent. The [README](./README.md) covers what is here and how to run it.

## What this repository is for

These are the companion examples for two tutorials on modelcontextprotocol.io: [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) and [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client). The tutorials quote this code, so readers meet it line by line. Every change should leave the code easier to read, not just more complete.

## Keep the examples minimal

- Show the protocol, not production engineering. No retries, caching, config layers, logging frameworks or helper abstractions unless a tutorial teaches them.
- Prefer the SDK's most direct, idiomatic API over a clever or general one.
- Add a feature only when it shows something a reader needs to know about MCP. If it would only make the example more robust, leave it out.
- Keep dependencies to the MCP SDK, the Anthropic SDK and what the language needs to make an HTTP call or read `.env`.

## Comments

Explanations belong in the tutorial pages and the example READMEs, not in the source. Keep comments to a minimum: add one only where the code would otherwise look wrong or surprising, such as a workaround for an SDK limitation, and keep it to a line or two.

## Keep the five languages in sync

The Python, TypeScript, Go, Rust and Ruby versions of each example should behave the same way.

- A behavior change goes into all five in the same pull request. If one language can't follow, say why in the pull request and in that example's README.
- Differences that follow a language's conventions are fine (for example, `get-alerts` in TypeScript, `get_alerts` elsewhere). Differences in behavior are not.
- Update every affected README: each one documents its own example, and the root README describes what all of them share.

## Keep the tutorials in sync

The tutorials live in [`modelcontextprotocol/modelcontextprotocol`](https://github.com/modelcontextprotocol/modelcontextprotocol), under `docs/docs/<protocol version>/develop/build-server.mdx` and `build-client.mdx`. When a change touches code a tutorial quotes or describes, open a matching pull request there and link the two.

## Checks and tests

Run `make check` before opening a pull request. It runs the linters and formatters, rebuilds every example and runs the smoke tests. `make help` lists the per-language targets, such as `make lint-go`, for when you only have some toolchains installed.

| Language | Checks |
|---|---|
| Python | `ruff check`, `ruff format --check` |
| TypeScript | `tsc --noEmit` |
| Go | `gofmt -l`, `go vet` |
| Rust | `cargo fmt --check`, `cargo clippy -D warnings` |
| Ruby | `ruby -wc`, failing on warnings |

`make fmt` fixes formatting for Python, Go and Rust.

- A change to client behavior needs matching changes to the mock MCP server and the tool-loop test in [`tests/helpers`](./tests/helpers), so CI exercises the new behavior in all five clients. See [`tests/README.md`](./tests/README.md).
- Tests never call a real Anthropic API. Server tests may reach the National Weather Service API, and treat it being unreachable as a skip.

## Dependencies

Pin to released SDK versions, and commit the lockfiles. Dependabot opens the routine upgrades. When an SDK upgrade changes how an example has to be written, update all five languages and the tutorials as above.

## Pull requests

Follow the Contributing section of the [README](./README.md#contributing). In particular, say in the pull request if AI assistance was used.
