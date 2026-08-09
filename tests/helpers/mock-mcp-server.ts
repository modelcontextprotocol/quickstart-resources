#!/usr/bin/env node
/**
 * Mock MCP Server for testing clients
 *
 * Verifies that clients call `tools/list`, and advertises tools whose output
 * schemas cover both shapes a structured result can take: an object root, and
 * an array root (allowed as of protocol revision 2026-07-28).
 *
 * The array-rooted tool is deliberate. Clients that compile every declared
 * `outputSchema` up front — as the Go and Rust quickstart clients do — will
 * fail here if they assume an output schema is always `{"type": "object"}`.
 *
 * This uses the low-level `Server` rather than `McpServer` so the schemas are
 * written out literally, which is the point of a mock: what goes on the wire is
 * exactly what is in this file.
 */

import type { Tool } from "@modelcontextprotocol/server";
import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

// Track whether tools/list was called
let toolsListCalled = false;

const TOOLS: Tool[] = [
  {
    name: "get_alerts",
    description: "Mock alerts, returning a top-level array",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string" } },
      required: ["state"],
    },
    // Array root: legal as of 2026-07-28, rejected by older revisions.
    outputSchema: {
      type: "array",
      items: {
        type: "object",
        properties: { event: { type: "string" }, area: { type: "string" } },
        required: ["event", "area"],
      },
    },
  },
  {
    name: "get_forecast",
    description: "Mock forecast, returning an object",
    inputSchema: {
      type: "object",
      properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
      },
      required: ["latitude", "longitude"],
    },
    outputSchema: {
      type: "object",
      properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
        summary: { type: "string" },
      },
      required: ["latitude", "longitude", "summary"],
    },
  },
];

function buildServer(): Server {
  const server = new Server(
    { name: "mock-test-server", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler("tools/list", async () => {
    toolsListCalled = true;
    return { tools: TOOLS };
  });

  server.setRequestHandler("tools/call", async (request) => {
    const { name, arguments: args = {} } = request.params;

    if (name === "get_alerts") {
      const state = String((args as { state?: unknown }).state ?? "??");
      const alerts = [{ event: "Mock Warning", area: state }];
      return {
        content: [{ type: "text", text: `1 alert for ${state}` }],
        structuredContent: alerts,
      };
    }

    if (name === "get_forecast") {
      const { latitude = 0, longitude = 0 } = args as {
        latitude?: number;
        longitude?: number;
      };
      const forecast = { latitude, longitude, summary: "Mock conditions" };
      return {
        content: [{ type: "text", text: forecast.summary }],
        structuredContent: forecast,
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  return server;
}

serveStdio(buildServer);
console.error("Mock MCP Server running on stdio");

// Verify that tools/list was called when the connection closes
process.stdin.on("end", () => {
  if (!toolsListCalled) {
    console.error("Error: Client did not call tools/list");
    process.exit(1);
  }
});
