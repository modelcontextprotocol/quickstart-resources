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
    check_dependency uv
    local server_dir="${PROJECT_ROOT}/weather-server-python"
    node "${TEST_CLIENT}" uv --directory "${server_dir}" run weather.py
}

# Test: TypeScript weather server
test_weather_server_typescript() {
    check_dependency node
    check_dependency npm
    local server_dir="${PROJECT_ROOT}/weather-server-typescript"
    ensure_built "${server_dir}"
    node "${TEST_CLIENT}" node "${server_dir}/build/index.js"
}

# Test: Rust weather server
test_weather_server_rust() {
    check_dependency cargo
    local server_dir="${PROJECT_ROOT}/weather-server-rust"
    ensure_built "${server_dir}"

    # Determine which binary to use
    if [ -f "${server_dir}/target/release/weather" ]; then
        local server_bin="${server_dir}/target/release/weather"
    else
        local server_bin="${server_dir}/target/debug/weather"
    fi

    node "${TEST_CLIENT}" "${server_bin}"
}

# Test: Python MCP client
test_mcp_client_python() {
    check_dependency uv
    local client_dir="${PROJECT_ROOT}/mcp-client-python"
    uv --directory "${client_dir}" run python "${client_dir}/client.py" "${MOCK_SERVER}" >/dev/null 2>&1
}

# Test: TypeScript MCP client
test_mcp_client_typescript() {
    check_dependency node
    check_dependency npm
    local client_dir="${PROJECT_ROOT}/mcp-client-typescript"
    ensure_built "${client_dir}"
    node "${client_dir}/build/index.js" "${MOCK_SERVER}" >/dev/null 2>&1
}

# Run all tests
print_header "Running smoke tests"
run_test "weather-server-python" test_weather_server_python
run_test "weather-server-typescript" test_weather_server_typescript
run_test "weather-server-rust" test_weather_server_rust
run_test "mcp-client-python" test_mcp_client_python
run_test "mcp-client-typescript" test_mcp_client_typescript

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
