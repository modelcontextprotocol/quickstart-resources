#!/bin/bash
# Shared utilities for test scripts

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print functions
print_header() {
    echo -e "${YELLOW}==== $1 ====${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Get project root directory
get_project_root() {
    cd "$(dirname "$0")/.." && pwd
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependency and exit if not found
check_dependency() {
    local cmd=$1
    if ! command_exists "${cmd}"; then
        print_error "${cmd} is not installed"
        exit 1
    fi
}

# Setup test environment
setup_test() {
    local test_name=$1
    print_header "Testing ${test_name}"

    PROJECT_ROOT=$(get_project_root)
    SERVER_DIR="${PROJECT_ROOT}/${test_name}"
    CLIENT_DIR="${PROJECT_ROOT}/${test_name}"
    TEST_CLIENT="${PROJECT_ROOT}/tests/helpers/build/mcp-test-client.js"
    MOCK_SERVER="${PROJECT_ROOT}/tests/helpers/build/mock-mcp-server.js"
}

# Ensure test helpers are built
ensure_helpers_built() {
    if [ ! -f "${TEST_CLIENT}" ] || [ ! -f "${MOCK_SERVER}" ]; then
        print_error "Test helpers not built"
        print_header "Building test helpers..."
        cd "${PROJECT_ROOT}/tests/helpers" || exit 1
        npm install >/dev/null 2>&1
        npm run build >/dev/null 2>&1
        cd - >/dev/null || exit 1
        print_success "Test helpers built"
    fi
}

# Ensure a project directory is built (TypeScript/Rust)
ensure_built() {
    local dir=$1
    cd "${dir}" || exit 1

    # Install npm dependencies if needed
    if [ -f "package.json" ] && [ ! -d "node_modules" ]; then
        npm install >/dev/null 2>&1
    fi

    # Build TypeScript if needed
    if [ -f "tsconfig.json" ] && [ ! -f "build/index.js" ]; then
        npm run build >/dev/null 2>&1
    fi

    # Build Rust if needed
    if [ -f "Cargo.toml" ] && [ ! -f "target/release/weather" ] && [ ! -f "target/debug/weather" ]; then
        cargo build --release >/dev/null 2>&1
    fi
}
