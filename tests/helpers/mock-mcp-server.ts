#!/usr/bin/env node
/**
 * Mock MCP Server for testing clients
 *
 * Verifies that clients call `tools/list`, and advertises tools whose output
 * schemas cover both shapes a structured result can take: an object root, and
 * an array root (allowed as of protocol revision 2026-07-28).
 *
 * Three more tools return results a client must translate with care before
 * passing them to the model (see tool-loop-test.ts):
 *
 *  - `rejected_call` fails at the protocol level (a JSON-RPC error, not an
 *    `isError` result);
 *  - `structured_only` returns `structuredContent` and an empty text block;
 *  - `non_text` returns an image, a text resource, an audio block, and an
 *    empty text block and resource (the Messages API rejects empty text).
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
import { IMAGE_DATA, RESOURCE_TEXT, STRUCTURED_ONLY_VALUE } from "./mock-values.js";

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
  {
    name: "rejected_call",
    description: "Mock tool the server always rejects with a JSON-RPC error",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "structured_only",
    description: "Mock tool returning structuredContent and only empty text",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
  },
  {
    name: "non_text",
    description: "Mock tool returning image, resource, audio and empty text blocks",
    inputSchema: { type: "object", properties: {} },
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

    if (name === "rejected_call") {
      // Thrown from a low-level handler, this reaches the client as a JSON-RPC
      // error response rather than a result.
      throw new Error("rejected_call is always rejected");
    }

    if (name === "structured_only") {
      return {
        content: [{ type: "text", text: "" }],
        structuredContent: { value: STRUCTURED_ONLY_VALUE },
      };
    }

    if (name === "non_text") {
      return {
        content: [
          { type: "image", data: IMAGE_DATA, mimeType: "image/png" },
          {
            type: "resource",
            resource: { uri: "mock://notes", mimeType: "text/plain", text: RESOURCE_TEXT },
          },
          { type: "audio", data: "AAAA", mimeType: "audio/wav" },
          { type: "text", text: "" },
          { type: "resource", resource: { uri: "mock://empty", mimeType: "text/plain", text: "" } },
        ],
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
