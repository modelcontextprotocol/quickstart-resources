#!/usr/bin/env node
/**
 * Minimal MCP Test Client for testing servers
 * Connects to a server, initializes, and lists tools
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function testServer(command: string, args: string[]) {
  console.error(`Testing server: ${command} ${args.join(" ")}`);

  const transport = new StdioClientTransport({
    command,
    args,
  });

  const client = new Client(
    {
      name: "mcp-test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  try {
    // Connect to server
    await client.connect(transport);
    console.error("✓ Connected to server");

    // List tools
    const { tools } = await client.listTools();
    console.error(`✓ Listed ${tools.length} tools`);

    // Success
    console.error("✓ Server test passed");
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error(`✗ Server test failed: ${error}`);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: mcp-test-client <command> [args...]");
  console.error("Example: mcp-test-client node server.js");
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);

testServer(command, commandArgs).catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
