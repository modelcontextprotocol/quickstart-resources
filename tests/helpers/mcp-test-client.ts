#!/usr/bin/env node
/**
 * Minimal MCP Test Client for testing servers
 *
 * Connects to a server, initializes, lists tools, and then checks the tools
 * actually honour what they advertise:
 *
 *  - every tool that declares an `outputSchema` is called, and the result must
 *    carry `structuredContent` (the SDK validates it against the schema for us
 *    and throws on a mismatch);
 *  - a tool whose `outputSchema` is array-rooted must answer with a top-level
 *    JSON array, not an object wrapping one.
 *
 * The second check is the point of the exercise. Listing tools alone would not
 * notice a server that advertises `{"type": "array"}` and then returns
 * `{"result": [...]}`.
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/** Arguments to call a tool with, chosen by matching its name. */
const TOOL_ARGUMENTS: { match: RegExp; args: Record<string, unknown> }[] = [
  { match: /alert/i, args: { state: "CA" } },
  { match: /forecast/i, args: { latitude: 38.5816, longitude: -121.4944 } },
];

function argumentsFor(name: string): Record<string, unknown> | undefined {
  return TOOL_ARGUMENTS.find(({ match }) => match.test(name))?.args;
}

/** The root `type` of a JSON Schema, when it declares a single one. */
function rootType(schema: unknown): string | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const type = (schema as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

async function testServer(command: string, args: string[]) {
  console.error(`Testing server: ${command} ${args.join(" ")}`);

  const transport = new StdioClientTransport({ command, args });

  // `auto` probes for 2026-07-28 and falls back to the 2025-11-25 handshake, so
  // this one helper tests servers of either era.
  const client = new Client(
    { name: "mcp-test-client", version: "1.0.0" },
    { capabilities: {}, versionNegotiation: { mode: "auto" } },
  );

  try {
    await client.connect(transport);
    console.error("✓ Connected to server");

    const { tools } = await client.listTools();
    console.error(`✓ Listed ${tools.length} tools`);

    let checked = 0;
    for (const tool of tools) {
      if (!tool.outputSchema) continue;

      const toolArgs = argumentsFor(tool.name);
      if (!toolArgs) {
        console.error(`  - ${tool.name}: no known arguments, skipping call`);
        continue;
      }

      // A throw here is the SDK rejecting the result against `outputSchema`.
      const result = await client.callTool({
        name: tool.name,
        arguments: toolArgs,
      });

      // Upstream (api.weather.gov) being unreachable surfaces as an error
      // result, which is a legitimate answer and carries no structured data.
      // Skip rather than fail the build on someone else's outage.
      if (result.isError) {
        console.error(`  - ${tool.name}: returned an error result, skipping`);
        continue;
      }

      if (result.structuredContent === undefined) {
        throw new Error(
          `${tool.name} declares an output schema but returned no structuredContent`,
        );
      }

      const expected = rootType(tool.outputSchema);
      const isArray = Array.isArray(result.structuredContent);

      if (expected === "array" && !isArray) {
        throw new Error(
          `${tool.name} declares an array-rooted output schema but returned ` +
            `${JSON.stringify(result.structuredContent).slice(0, 80)}`,
        );
      }
      if (expected === "object" && isArray) {
        throw new Error(
          `${tool.name} declares an object-rooted output schema but returned an array`,
        );
      }

      console.error(
        `✓ ${tool.name}: structuredContent is ${isArray ? "a top-level array" : "an object"}, matching its schema`,
      );
      checked += 1;
    }

    console.error(`✓ Verified structured output for ${checked} tools`);
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
