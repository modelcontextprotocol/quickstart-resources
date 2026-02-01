#!/usr/bin/env node
/**
 * Mock MCP Server for testing clients
 * Verifies that clients call the tools/list method and returns an empty tool list
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new McpServer(
  {
    name: "mock-test-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Track whether tools/list was called
let toolsListCalled = false;

// Override the default tools/list handler to track calls
server.server.setRequestHandler(ListToolsRequestSchema, async () => {
  toolsListCalled = true;
  return { tools: [] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mock MCP Server running on stdio");
}

// Verify that tools/list was called when the connection closes
process.stdin.on("end", () => {
  if (!toolsListCalled) {
    console.error("Error: Client did not call tools/list");
    process.exit(1);
  }
});

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
