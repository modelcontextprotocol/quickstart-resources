#!/usr/bin/env node
/**
 * Tool-loop test for clients
 *
 * Runs a quickstart client through scripted queries and checks that its
 * tool-use loop is right. Two stand-ins replace the real world:
 *
 *  - the mock MCP server (mock-mcp-server.ts), passed as part of the client
 *    command exactly as in the no-key client test;
 *  - a fake Anthropic Messages API, started here on a loopback port and handed
 *    to the client through ANTHROPIC_BASE_URL, which every quickstart SDK reads.
 *
 * Three queries are piped into one client process, and the fake API picks the
 * script from the query text:
 *
 *  - "parallel tools": text plus two tool_use blocks in one response, then one
 *    tool_use for a tool the mock server lacks (an error result), then an
 *    answer. Checks that tools are passed on every call, max_tokens leaves
 *    room for thinking, every tool_use gets a tool_result in a single
 *    following user message with matching ids, and the error is forwarded.
 *  - "ten tool turns": exactly MAX_TOOL_TURNS tool calls, then an answer. The
 *    client must print the answer without a premature stop notice.
 *  - "endless tool turns": a tool call on every response. The client must stop
 *    after MAX_TOOL_TURNS rounds, say so, and make no further call.
 *
 * A client that does one tool round and stops, drops `tools` on the second
 * call, sends one tool_result per message, or gets the turn cap wrong fails
 * here and passes the no-key test.
 *
 * Usage: node tool-loop-test.js <client command> [args...]
 */

import { spawn } from "node:child_process";
import http from "node:http";

/** Sonnet 5 thinks adaptively; the clients reserve this much for it. */
const EXPECTED_MAX_TOKENS = 10000;
/** MAX_TOOL_TURNS in every client. */
const MAX_TOOL_TURNS = 10;
const STOP_NOTICE = `[Stopped after ${MAX_TOOL_TURNS} tool-use turns]`;
/** Every client prints this before reading a query. */
const PROMPT = "Query: ";
const CLIENT_TIMEOUT_MS = 180_000;

const QUERIES = {
  parallel: "parallel tools",
  atLimit: "ten tool turns",
  overrun: "endless tool turns",
} as const;
type Scenario = keyof typeof QUERIES;

const FINAL_ANSWER: Record<Scenario, string> = {
  parallel: "All done.",
  atLimit: "Answered at the limit.",
  overrun: "never sent",
};

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
const calls: Record<Scenario, number> = { parallel: 0, atLimit: 0, overrun: 0 };

function check(condition: boolean, what: string) {
  if (condition) {
    passed++;
  } else {
    failures.push(what);
  }
}

function toolResultsOf(message: Message | undefined): Block[] {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content.filter((block) => block.type === "tool_result");
}

/** Text content may be a string or a list of text blocks. */
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

/** The scenario a request belongs to: named by its most recent user query. */
function scenarioOf(messages: Message[]): Scenario | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user" || toolResultsOf(message).length > 0) continue;
    const text = textOf(message.content).trim();
    return (Object.keys(QUERIES) as Scenario[]).find((key) => QUERIES[key] === text);
  }
  return undefined;
}

function toolUse(id: string, name: string, input: Record<string, unknown>): Block {
  return { type: "tool_use", id, name, input };
}

function text(value: string): Block {
  return { type: "text", text: value };
}

/** The scripted assistant turn for the parallel-tools query. */
function respondParallel(n: number, request: Request): Block[] {
  const label = `parallel call ${n}`;
  const { messages } = request;
  const last = messages[messages.length - 1];
  const results = toolResultsOf(last);

  if (n === 1) {
    check(messages.length === 1 && last.role === "user", `${label}: history is the user query`);
    return [
      text("Checking two things."),
      toolUse("tu_1", "get_alerts", { state: "CA" }),
      toolUse("tu_2", "get_forecast", { latitude: 38.58, longitude: -121.49 }),
    ];
  }

  if (n === 2) {
    check(messages.length === 3, `${label}: history has 3 messages (got ${messages.length})`);
    check(messages[1]?.role === "assistant", `${label}: assistant turn is kept in history`);
    check(
      last.role === "user" && results.length === 2,
      `${label}: both tool_results arrive in one user message (got ${results.length})`,
    );
    const ids = results.map((block) => block.tool_use_id).sort().join(",");
    check(ids === "tu_1,tu_2", `${label}: tool_use_ids match (got ${ids})`);
    check(
      results.every((block) => textOf(block.content).length > 0),
      `${label}: tool_result content carries the tool's text`,
    );
    check(
      results.every((block) => block.is_error !== true),
      `${label}: successful results are not flagged as errors`,
    );
    return [toolUse("tu_3", "no_such_tool", {})];
  }

  if (n === 3) {
    check(messages.length === 5, `${label}: history has 5 messages (got ${messages.length})`);
    check(
      results.length === 1 && results[0].tool_use_id === "tu_3",
      `${label}: second-step tool_result is present`,
    );
    // Rust's genai crate has no is_error field, so that client marks the
    // text instead; accept either.
    const flagged = results[0]?.is_error === true;
    const marked = textOf(results[0]?.content).startsWith("Error:");
    check(flagged || marked, `${label}: error result is forwarded as an error`);
    return [text(FINAL_ANSWER.parallel)];
  }

  check(false, `${label}: unexpected extra call`);
  return [text("extra")];
}

/**
 * The scripted turn for the two turn-limit queries. Each response asks for one
 * more tool call; the previous call's result must be present. At the limit the
 * script answers on call MAX_TOOL_TURNS + 1; past it, it never stops asking.
 */
function respondTurnLimit(scenario: "atLimit" | "overrun", n: number, request: Request): Block[] {
  const label = `${scenario === "atLimit" ? "at-limit" : "overrun"} call ${n}`;
  const prefix = scenario === "atLimit" ? "tl" : "ov";
  const last = request.messages[request.messages.length - 1];
  const results = toolResultsOf(last);

  if (n > 1) {
    check(
      results.length === 1 && results[0].tool_use_id === `${prefix}_${n - 1}`,
      `${label}: previous tool_result is present`,
    );
  }

  // The initial call plus MAX_TOOL_TURNS follow-ups is the most a client makes.
  if (n > MAX_TOOL_TURNS + 1) {
    check(false, `${label}: client called past the turn limit`);
    return [text("extra")];
  }
  if (scenario === "atLimit" && n === MAX_TOOL_TURNS + 1) {
    return [text(FINAL_ANSWER.atLimit)];
  }
  // Distinct tools per scenario, so their "[Calling tool ...]" lines can be
  // told apart in the client's output.
  return scenario === "atLimit"
    ? [toolUse(`${prefix}_${n}`, "get_forecast", { latitude: 40.7, longitude: -74.0 })]
    : [toolUse(`${prefix}_${n}`, "get_alerts", { state: "NY" })];
}

function respond(request: Request): Block[] {
  const scenario = scenarioOf(request.messages);
  if (!scenario) {
    check(false, "request belongs to a known query");
    return [text("unknown query")];
  }
  const n = ++calls[scenario];

  check(
    Array.isArray(request.tools) && request.tools.length === 2,
    `${scenario} call ${n}: tools are passed (got ${request.tools?.length ?? "none"})`,
  );
  check(
    request.max_tokens === EXPECTED_MAX_TOKENS,
    `${scenario} call ${n}: max_tokens is ${EXPECTED_MAX_TOKENS} (got ${request.max_tokens})`,
  );

  return scenario === "parallel" ? respondParallel(n, request) : respondTurnLimit(scenario, n, request);
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
          id: `msg_${Object.values(calls).reduce((a, b) => a + b, 0)}`,
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
    // Type each line only once the client shows its prompt, as a user would.
    // Lines written ahead of time are dropped by readline-based clients, and
    // closing stdin early ends the session before the later queries.
    const lines = [...Object.values(QUERIES), "quit"];
    let prompts = 0;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const seen = stdout.split(PROMPT).length - 1;
      while (prompts < seen && lines.length > 0) {
        prompts++;
        child.stdin.write(`${lines.shift()}\n`);
      }
    });
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
  });
}

/** Checks on the client's output once it has exited. */
function checkOutput(code: number | null, stdout: string) {
  check(code === 0, `client exited 0 (got ${code})`);
  check(calls.parallel === 3, `parallel: API was called 3 times (got ${calls.parallel})`);
  check(stdout.includes(FINAL_ANSWER.parallel), "parallel: client printed the final answer");

  const expected = MAX_TOOL_TURNS + 1;
  check(calls.atLimit === expected, `at-limit: API was called ${expected} times (got ${calls.atLimit})`);
  check(calls.overrun === expected, `overrun: API was called ${expected} times (got ${calls.overrun})`);

  // Output arrives in query order. The at-limit answer is followed by the
  // overrun query's first tool call; a stop notice between the two is wrong,
  // and exactly one must follow.
  const answerAt = stdout.indexOf(FINAL_ANSWER.atLimit);
  const overrunAt = answerAt < 0 ? -1 : stdout.indexOf("[Calling tool get_alerts", answerAt);
  check(answerAt >= 0, "at-limit: client printed the final answer");
  check(overrunAt > answerAt, "overrun: client called the tool");
  if (answerAt >= 0 && overrunAt > answerAt) {
    check(
      !stdout.slice(answerAt, overrunAt).includes(STOP_NOTICE),
      "at-limit: no stop notice after an answer at the limit",
    );
    const notices = stdout.slice(overrunAt).split(STOP_NOTICE).length - 1;
    check(notices === 1, `overrun: stop notice printed once (got ${notices})`);
  }
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
  checkOutput(code, stdout);

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
