#!/usr/bin/env node
/**
 * Tool-loop test for clients
 *
 * Runs a quickstart client through one scripted query and checks that its
 * tool-use loop is right. Two stand-ins replace the real world:
 *
 *  - the mock MCP server (mock-mcp-server.ts), passed as part of the client
 *    command exactly as in the no-key client test;
 *  - a fake Anthropic Messages API, started here on a loopback port and handed
 *    to the client through ANTHROPIC_BASE_URL, which every quickstart SDK reads.
 *
 * The fake API scripts one conversation:
 *
 *   call 1 -> text plus two tool_use blocks in one response (parallel calls)
 *   call 2 -> one tool_use for a tool the mock server does not have, so the
 *             tool result is an error
 *   call 3 -> a final text answer
 *
 * and checks every request the client sends: tools are passed each time,
 * max_tokens leaves room for thinking, every tool_use gets a tool_result in a
 * single following user message, ids match, and the error result is flagged.
 * A client that does one tool round and stops, drops `tools` on the second
 * call, or sends one tool_result per message fails here and passes the no-key
 * test.
 *
 * Usage: node tool-loop-test.js <client command> [args...]
 */

import { spawn } from "node:child_process";
import http from "node:http";

/** Sonnet 5 thinks adaptively; the clients reserve this much for it. */
const EXPECTED_MAX_TOKENS = 10000;
const EXPECTED_CALLS = 3;
const QUERY = "What is the weather like?\n";
const CLIENT_TIMEOUT_MS = 120_000;

type Block = Record<string, unknown> & { type: string };
type Message = { role: string; content: string | Block[] };
type Request = {
  model?: string;
  max_tokens?: number;
  tools?: unknown[];
  messages: Message[];
};

const failures: string[] = [];
let passed = 0;
let calls = 0;

function check(condition: boolean, what: string) {
  if (condition) {
    passed++;
  } else {
    failures.push(`call ${calls}: ${what}`);
  }
}

function toolResultsOf(message: Message | undefined): Block[] {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content.filter((block) => block.type === "tool_result");
}

/** tool_result content may be a string or a list of text blocks. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === "text")
      .map((block) => String(block.text))
      .join("\n");
  }
  return "";
}

/** The scripted assistant turn for this call, after checking the request. */
function respond(request: Request): Block[] {
  calls++;
  const { messages } = request;
  const last = messages[messages.length - 1];
  const results = toolResultsOf(last);

  check(
    Array.isArray(request.tools) && request.tools.length === 2,
    `tools are passed (got ${request.tools?.length ?? "none"})`,
  );
  check(
    request.max_tokens === EXPECTED_MAX_TOKENS,
    `max_tokens is ${EXPECTED_MAX_TOKENS} (got ${request.max_tokens})`,
  );

  if (calls === 1) {
    check(messages.length === 1 && last.role === "user", "history is the user query");
    return [
      { type: "text", text: "Checking two things." },
      { type: "tool_use", id: "tu_1", name: "get_alerts", input: { state: "CA" } },
      {
        type: "tool_use",
        id: "tu_2",
        name: "get_forecast",
        input: { latitude: 38.58, longitude: -121.49 },
      },
    ];
  }

  if (calls === 2) {
    check(messages.length === 3, `history has 3 messages (got ${messages.length})`);
    check(messages[1]?.role === "assistant", "assistant turn is kept in history");
    check(
      last.role === "user" && results.length === 2,
      `both tool_results arrive in one user message (got ${results.length})`,
    );
    const ids = results.map((block) => block.tool_use_id).sort().join(",");
    check(ids === "tu_1,tu_2", `tool_use_ids match (got ${ids})`);
    check(
      results.every((block) => textOf(block.content).length > 0),
      "tool_result content carries the tool's text",
    );
    check(
      results.every((block) => block.is_error !== true),
      "successful results are not flagged as errors",
    );
    return [{ type: "tool_use", id: "tu_3", name: "no_such_tool", input: {} }];
  }

  if (calls === 3) {
    check(messages.length === 5, `history has 5 messages (got ${messages.length})`);
    check(
      results.length === 1 && results[0].tool_use_id === "tu_3",
      "second-step tool_result is present",
    );
    // Rust's genai crate has no is_error field, so that client marks the
    // text instead; accept either.
    const flagged = results[0]?.is_error === true;
    const marked = textOf(results[0]?.content).startsWith("Error:");
    check(flagged || marked, "error result is forwarded as an error");
    return [{ type: "text", text: "All done." }];
  }

  check(false, "unexpected extra call");
  return [{ type: "text", text: "extra" }];
}

function startFakeApi(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let request: Request;
      try {
        request = JSON.parse(body) as Request;
      } catch {
        calls++;
        check(false, "request body is JSON");
        res.writeHead(400).end();
        return;
      }
      const content = respond(request);
      const stopReason = content.some((block) => block.type === "tool_use")
        ? "tool_use"
        : "end_turn";
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `msg_${calls}`,
          type: "message",
          role: "assistant",
          model: request.model,
          content,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function runClient(
  command: string,
  args: string[],
  baseUrl: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_API_KEY: "test-key" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      failures.push(`client did not exit within ${CLIENT_TIMEOUT_MS / 1000}s`);
      child.kill();
    }, CLIENT_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      failures.push(`could not start client: ${error.message}`);
      resolve({ code: null, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.write(QUERY);
    child.stdin.write("quit\n");
    child.stdin.end();
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error("Usage: node tool-loop-test.js <client command> [args...]");
    process.exit(1);
  }

  const api = await startFakeApi();
  const address = api.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.error(`Testing client tool loop: ${command} ${args.join(" ")}`);

  const { code, stdout, stderr } = await runClient(command, args, baseUrl);
  api.close();

  calls = EXPECTED_CALLS; // label the closing checks
  check(code === 0, `client exited 0 (got ${code})`);
  check(calls === EXPECTED_CALLS, `API was called ${EXPECTED_CALLS} times`);
  check(stdout.includes("All done."), "client printed the final answer");

  if (failures.length === 0) {
    console.error(`✓ Tool loop correct (${passed} checks)`);
    return;
  }
  console.error(`✗ Tool loop failed ${failures.length} of ${passed + failures.length} checks:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("--- client stdout ---");
  console.error(stdout.trim());
  console.error("--- client stderr ---");
  console.error(stderr.trim());
  process.exit(1);
}

main().catch((error) => {
  console.error("✗ Tool loop test crashed:", error);
  process.exit(1);
});
