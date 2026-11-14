#!/usr/bin/env node
/**
 * Minimal MCP Test Client for testing servers
 *
 * First lists tools over a raw 2025-11-25 session, without the SDK, and checks
 * that the call succeeds and that every `outputSchema` has an `object` root,
 * which that revision requires. A client SDK may quietly drop or rewrite a
 * tool it can't accept, so only the raw response shows what an older client
 * receives.
 *
 * Then connects with the SDK, which negotiates 2026-07-28 where the server
 * supports it, lists tools, and checks the tools honour what they advertise:
 *
 *  - every tool declares the same annotations (read-only, open-world);
 *  - every `outputSchema` still has an `object` root;
 *  - every tool that declares an `outputSchema` is called, and the result must
 *    carry `structuredContent` (the SDK validates it against the schema for us
 *    and throws on a mismatch) that is an object, not an array.
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Arguments to call a tool with, chosen by matching its name. */
const TOOL_ARGUMENTS: { match: RegExp; args: Record<string, unknown> }[] = [
  { match: /alert/i, args: { state: "CA" } },
  { match: /forecast/i, args: { latitude: 38.5816, longitude: -121.4944 } },
];

/**
 * The annotations every weather tool must declare, identical across the five
 * servers. All four are set explicitly because the Go and Ruby SDKs always send
 * some hints, so leaving them to defaults would make the servers disagree.
 */
const EXPECTED_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function argumentsFor(name: string): Record<string, unknown> | undefined {
  return TOOL_ARGUMENTS.find(({ match }) => match.test(name))?.args;
}

/** The root `type` of a JSON Schema, when it declares a single one. */
function rootType(schema: unknown): string | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const type = (schema as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

/** Fails unless every tool's `outputSchema`, where it declares one, has an object root. */
function assertObjectRoots(tools: { name: string; outputSchema?: unknown }[], era: string) {
  for (const tool of tools) {
    if (tool.outputSchema === undefined) continue;
    const type = rootType(tool.outputSchema);
    if (type !== "object") {
      throw new Error(
        `${tool.name} declares an outputSchema with root type ${JSON.stringify(type)} ` +
          `on a ${era} session; it must be "object"`,
      );
    }
  }
}

const LEGACY_PROTOCOL_VERSION = "2025-11-25";

/**
 * Sends `initialize` for 2025-11-25, then `tools/list`, as raw JSON-RPC over
 * stdio, and checks the reply the way a strict 2025-11-25 client would.
 */
async function testLegacySession(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout });
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);

  const responses = new Map<number, (message: any) => void>();
  lines.on("line", (line) => {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    responses.get(message.id)?.(message);
  });

  const request = (id: number, method: string, params: object = {}) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no response to ${method} within 60s`)),
        60_000,
      );
      child.once("exit", (code) => reject(new Error(`server exited (${code}) before answering ${method}`)));
      responses.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });

  try {
    const init = await request(1, "initialize", {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcp-test-client", version: "1.0.0" },
    });
    if (init.error) {
      throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
    }
    if (init.result?.protocolVersion !== LEGACY_PROTOCOL_VERSION) {
      throw new Error(
        `server answered initialize with ${init.result?.protocolVersion}, not ${LEGACY_PROTOCOL_VERSION}`,
      );
    }
    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    const list = await request(2, "tools/list");
    if (list.error) {
      throw new Error(`tools/list failed: ${JSON.stringify(list.error)}`);
    }
    const tools = list.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error(`tools/list returned no tools: ${JSON.stringify(list.result)}`);
    }
    assertObjectRoots(tools, LEGACY_PROTOCOL_VERSION);
    console.error(
      `✓ ${LEGACY_PROTOCOL_VERSION} session: listed ${tools.length} tools, every outputSchema has an object root`,
    );
  } finally {
    lines.close();
    child.stdin.end();
    child.kill();
  }
}

async function testServer(command: string, args: string[]) {
  console.error(`Testing server: ${command} ${args.join(" ")}`);

  try {
    await testLegacySession(command, args);
  } catch (error) {
    console.error(`✗ Server test failed: ${error}`);
    process.exit(1);
  }

  const transport = new StdioClientTransport({ command, args });

  // `auto` probes for 2026-07-28 and falls back to the 2025-11-25 handshake, so
  // this one helper tests servers of either era.
  const client = new Client(
    { name: "mcp-test-client", version: "1.0.0" },
    { capabilities: {}, versionNegotiation: { mode: "auto" } },
  );

  try {
    await client.connect(transport);
    console.error(`✓ Connected to server, negotiated ${client.getNegotiatedProtocolVersion()}`);

    const { tools } = await client.listTools();
    console.error(`✓ Listed ${tools.length} tools`);
    assertObjectRoots(tools, client.getNegotiatedProtocolVersion() ?? "negotiated");

    for (const tool of tools) {
      for (const [hint, value] of Object.entries(EXPECTED_ANNOTATIONS)) {
        const actual = tool.annotations?.[hint as keyof typeof EXPECTED_ANNOTATIONS];
        if (actual !== value) {
          throw new Error(
            `${tool.name} should set annotations.${hint} to ${value}, got ${actual}`,
          );
        }
      }
    }
    console.error(`✓ All ${tools.length} tools carry the expected annotations`);

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

      if (Array.isArray(result.structuredContent)) {
        throw new Error(`${tool.name} returned an array as structuredContent; expected an object`);
      }

      console.error(`✓ ${tool.name}: structuredContent is an object, matching its schema`);
      checked += 1;
    }

    console.error(`✓ Verified structured content for ${checked} tools`);
    console.error("✓ Server test passed");
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error(`✗ Server test failed: ${error}`);
    // Close on the way out too, or the spawned server outlives this process and
    // a failing test hangs instead of reporting.
    await client.close().catch(() => {});
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
