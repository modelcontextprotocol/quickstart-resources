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

# Check dependency and fail the calling test if not found.
#
# Returns rather than exits: a missing toolchain should fail its own test and
# let the rest of the suite run, not abort the whole script before the summary
# is printed.
check_dependency() {
    local cmd=$1
    if ! command_exists "${cmd}"; then
        print_error "${cmd} is not installed"
        return 1
    fi
}

# The executable suffix for this platform: ".exe" under MSYS/Git Bash, empty
# elsewhere. Windows will not run a binary without it, whatever the file is
# actually named.
exe_suffix() {
    case "$(uname -s)" in
        MINGW* | MSYS* | CYGWIN*) echo ".exe" ;;
        *) echo "" ;;
    esac
}

# Echo the path to a built binary, accounting for the .exe suffix on Windows.
# Prints nothing and returns 1 when neither exists.
resolve_binary() {
    local path=$1
    if [ -f "${path}$(exe_suffix)" ]; then
        echo "${path}$(exe_suffix)"
    elif [ -f "${path}" ]; then
        echo "${path}"
    else
        return 1
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

# Run a build step, showing its output only if it fails.
#
# Builds used to be run with `>/dev/null 2>&1` unconditionally, which hid
# compile errors: a failed build left no binary behind and the smoke test
# reported the downstream `spawn ... ENOENT` instead of the actual error.
run_build() {
    local what=$1
    shift
    local output
    if ! output=$("$@" 2>&1); then
        print_error "${what} failed"
        echo "${output}"
        return 1
    fi
}

# Ensure a project directory is built (TypeScript/Rust/Go)
ensure_built() {
    local dir=$1
    cd "${dir}" || exit 1

    # Install npm dependencies if needed
    if [ -f "package.json" ] && [ ! -d "node_modules" ]; then
        run_build "npm install in ${dir}" npm install || return 1
    fi

    # Build TypeScript if needed
    if [ -f "tsconfig.json" ] && [ ! -f "build/index.js" ]; then
        run_build "npm run build in ${dir}" npm run build || return 1
    fi

    # Build Rust if needed
    if [ -f "Cargo.toml" ] \
        && ! resolve_binary "target/release/weather" >/dev/null \
        && ! resolve_binary "target/debug/weather" >/dev/null; then
        run_build "cargo build in ${dir}" cargo build --release || return 1
    fi

    # Build Go if needed
    if [ -f "go.mod" ] && ! resolve_binary "server" >/dev/null; then
        run_build "go build in ${dir}" go build -o "server$(exe_suffix)" . || return 1
    fi
}
