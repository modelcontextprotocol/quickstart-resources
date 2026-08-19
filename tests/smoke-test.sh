#!/bin/bash
set -e

# Source utilities
source "$(dirname "$0")/utils.sh"

print_header "MCP Quickstart Smoke Tests"

# Get project root
PROJECT_ROOT=$(get_project_root)
TESTS_DIR="${PROJECT_ROOT}/tests"

# Setup common test variables
TEST_CLIENT="${PROJECT_ROOT}/tests/helpers/build/mcp-test-client.js"
MOCK_SERVER="${PROJECT_ROOT}/tests/helpers/build/mock-mcp-server.js"

# Track test results
FAILED_TESTS=()
PASSED_TESTS=()

# Build test helpers
ensure_helpers_built

# Helper function to run a test and track results
run_test() {
    local test_name=$1
    echo ""
    print_header "Testing ${test_name}"

    if "${@:2}"; then
        PASSED_TESTS+=("${test_name}")
        print_success "${test_name} test passed"
    else
        FAILED_TESTS+=("${test_name}")
        print_error "${test_name} test failed"
    fi
}

# Test: Python weather server
test_weather_server_python() {
    check_dependency uv || return 1
    local server_dir="${PROJECT_ROOT}/weather-server-python"
    node "${TEST_CLIENT}" uv --directory "${server_dir}" run weather.py
}

# Test: TypeScript weather server
test_weather_server_typescript() {
    check_dependency node || return 1
    check_dependency npm || return 1
    local server_dir="${PROJECT_ROOT}/weather-server-typescript"
    ensure_built "${server_dir}" || return 1
    node "${TEST_CLIENT}" node "${server_dir}/build/index.js"
}

# Test: Rust weather server
test_weather_server_rust() {
    check_dependency cargo || return 1
    local server_dir="${PROJECT_ROOT}/weather-server-rust"
    ensure_built "${server_dir}" || return 1

    # Determine which binary to use
    local server_bin
    server_bin=$(resolve_binary "${server_dir}/target/release/weather" \
        || resolve_binary "${server_dir}/target/debug/weather") || {
        print_error "no weather binary found in ${server_dir}/target"
        return 1
    }

    node "${TEST_CLIENT}" "${server_bin}"
}

# Test: Go weather server
test_weather_server_go() {
    check_dependency go || return 1
    local server_dir="${PROJECT_ROOT}/weather-server-go"
    ensure_built "${server_dir}" || return 1

    local server_bin
    server_bin=$(resolve_binary "${server_dir}/server") || {
        print_error "no server binary found in ${server_dir}"
        return 1
    }

    node "${TEST_CLIENT}" "${server_bin}"
}

# The client tests drive the no-API-key path, where each client prints a notice
# and exits. Empty rather than unset: dotenv skips a name already present in
# ENV, so a key in the environment or a local .env would start the chat loop.

# Test: Python MCP client
test_mcp_client_python() {
    check_dependency uv || return 1
    local client_dir="${PROJECT_ROOT}/mcp-client-python"
    ANTHROPIC_API_KEY= uv --directory "${client_dir}" run python "${client_dir}/client.py" "${MOCK_SERVER}" >/dev/null 2>&1
}

# Test: TypeScript MCP client
test_mcp_client_typescript() {
    check_dependency node || return 1
    check_dependency npm || return 1
    local client_dir="${PROJECT_ROOT}/mcp-client-typescript"
    ensure_built "${client_dir}" || return 1
    ANTHROPIC_API_KEY= node "${client_dir}/build/index.js" "${MOCK_SERVER}" >/dev/null 2>&1
}

# Test: Ruby MCP client
test_mcp_client_ruby() {
    check_dependency ruby || return 1
    check_dependency bundle || return 1
    local client_dir="${PROJECT_ROOT}/mcp-client-ruby"
    ensure_bundled "${client_dir}" || return 1
    (cd "${client_dir}" && ANTHROPIC_API_KEY= bundle exec ruby client.rb "${MOCK_SERVER}") >/dev/null 2>&1
}

# Run all tests
#
# The Go and Rust clients are not covered: on main both abort when no .env file
# is present, so they cannot be driven without credentials. Making them start
# credential-free is a change in their own directories, so their coverage lands
# with those changes rather than here.
#
# Nor is the Ruby weather server: the mcp gem does not stamp the resultType
# field that 2026-07-28 requires, so the test client rejects its responses.
print_header "Running smoke tests"
run_test "weather-server-python" test_weather_server_python
run_test "weather-server-typescript" test_weather_server_typescript
run_test "weather-server-rust" test_weather_server_rust
run_test "weather-server-go" test_weather_server_go
run_test "mcp-client-python" test_mcp_client_python
run_test "mcp-client-typescript" test_mcp_client_typescript
run_test "mcp-client-ruby" test_mcp_client_ruby

# Print summary
echo ""
print_header "Test Summary"
echo "Passed: ${#PASSED_TESTS[@]}"
for test in "${PASSED_TESTS[@]}"; do
    print_success "${test}"
done

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
    echo ""
    echo "Failed: ${#FAILED_TESTS[@]}"
    for test in "${FAILED_TESTS[@]}"; do
        print_error "${test}"
    done
    echo ""
    print_error "Some tests failed"
    exit 1
else
    echo ""
    print_success "All tests passed!"
    exit 0
fi
