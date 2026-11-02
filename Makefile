# Lint, format, build and test every example. `make check` is what CI runs.
# Each per-language target needs only that language's toolchain.

PYTHON_DIRS := weather-server-python mcp-client-python
TS_DIRS     := weather-server-typescript mcp-client-typescript tests/helpers
GO_DIRS     := weather-server-go mcp-client-go
RUST_DIRS   := weather-server-rust mcp-client-rust
RUBY_FILES  := weather-server-ruby/weather.rb mcp-client-ruby/client.rb

.PHONY: help check lint fmt build test \
	lint-python lint-typescript lint-go lint-rust lint-ruby \
	fmt-python fmt-go fmt-rust \
	build-typescript build-go build-rust

help:
	@echo "make check   lint, then build and run the smoke tests"
	@echo "make lint    check formatting and lint every example"
	@echo "make fmt     format Python, Go and Rust in place"
	@echo "make build   rebuild the TypeScript, Go and Rust examples"
	@echo "make test    rebuild, then run tests/smoke-test.sh"
	@echo "Per language: lint-{python,typescript,go,rust,ruby},"
	@echo "  fmt-{python,go,rust}, build-{typescript,go,rust}"

check: lint test

lint: lint-python lint-typescript lint-go lint-rust lint-ruby

fmt: fmt-python fmt-go fmt-rust

build: build-typescript build-go build-rust

# smoke-test.sh builds only what is missing, so rebuild first to avoid
# testing stale binaries.
test: build
	./tests/smoke-test.sh

lint-python:
	@set -e; for d in $(PYTHON_DIRS); do \
		echo "== ruff $$d"; \
		uv --directory $$d run --quiet ruff check .; \
		uv --directory $$d run --quiet ruff format --check .; \
	done

fmt-python:
	@set -e; for d in $(PYTHON_DIRS); do \
		uv --directory $$d run --quiet ruff check --fix .; \
		uv --directory $$d run --quiet ruff format .; \
	done

lint-typescript:
	@set -e; for d in $(TS_DIRS); do \
		echo "== tsc $$d"; \
		[ -d $$d/node_modules ] || npm --prefix $$d ci --silent; \
		(cd $$d && npx tsc --noEmit); \
	done

build-typescript:
	@set -e; for d in $(TS_DIRS); do \
		[ -d $$d/node_modules ] || npm --prefix $$d ci --silent; \
		npm --prefix $$d run --silent build; \
	done

lint-go:
	@set -e; for d in $(GO_DIRS); do \
		echo "== gofmt, go vet $$d"; \
		unformatted=$$(cd $$d && gofmt -l .); \
		if [ -n "$$unformatted" ]; then echo "needs gofmt: $$unformatted"; exit 1; fi; \
		(cd $$d && go vet ./...); \
	done

fmt-go:
	@set -e; for d in $(GO_DIRS); do (cd $$d && gofmt -w .); done

# The binary names are the ones smoke-test.sh runs.
build-go:
	cd weather-server-go && go build -o server .
	cd mcp-client-go && go build -o mcp-client-go .

lint-rust:
	@set -e; for d in $(RUST_DIRS); do \
		echo "== rustfmt, clippy $$d"; \
		(cd $$d && cargo fmt --check && cargo clippy --quiet --all-targets -- -D warnings); \
	done

fmt-rust:
	@set -e; for d in $(RUST_DIRS); do (cd $$d && cargo fmt); done

build-rust:
	@set -e; for d in $(RUST_DIRS); do (cd $$d && cargo build --quiet --release); done

# `ruby -wc` exits 0 even when it prints warnings, so fail on the output.
lint-ruby:
	@set -e; for f in $(RUBY_FILES); do \
		echo "== ruby -wc $$f"; \
		out=$$(ruby -wc $$f 2>&1); echo "$$out"; \
		if echo "$$out" | grep -q 'warning:'; then exit 1; fi; \
	done
