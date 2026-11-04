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
 * Nine queries are piped into one client process, and the fake API picks the
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
 *  - "tool result contents": three tool calls whose results need translating
 *    before they reach the model. One the server rejects with a JSON-RPC error
 *    must come back as an is_error tool_result, not end the query. One with
 *    structuredContent and only empty text must arrive as JSON. One with image,
 *    resource and audio blocks must arrive as an image block, the resource's
 *    text, and a placeholder for the audio. Empty text must be dropped: like
 *    the real API, this one rejects an empty text block in any request.
 *  - "refused query": a refusal. The client must print a notice and drop the
 *    query from its history.
 *  - "failed query": a tool call, then an API error. The client must print the
 *    error and drop the query, tool call included, from its history.
 *  - "empty reply": an end_turn reply with no content. The API rejects an
 *    empty assistant message, so the client must not keep it.
 *  - "cut off reply": a reply stopped by max_tokens. The client must print the
 *    partial text and a notice.
 *  - "after clear", typed after a blank line and `clear`: the history must be
 *    empty again, and the blank line must not have been sent.
 *
 * Every request must carry the same system prompt, every query after the first
 * must carry the earlier conversation, and the history must be one the API
 * accepts: no message empty, and every tool_use answered by a tool_result in
 * the next message.
 *
 * A client that does one tool round and stops, drops `tools` on the second
 * call, sends one tool_result per message, or gets the turn cap wrong fails
 * here and passes the no-key test.
 *
 * Usage: node tool-loop-test.js <client command> [args...]
 */

import { spawn } from "node:child_process";
import http from "node:http";
import { IMAGE_DATA, RESOURCE_TEXT, STRUCTURED_ONLY_VALUE } from "./mock-values.js";

/** Sonnet 5 thinks adaptively; the clients reserve this much for it. */
const EXPECTED_MAX_TOKENS = 10000;
/** How many tools the mock server lists. */
const MOCK_TOOL_COUNT = 5;
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
  contents: "tool result contents",
  refused: "refused query",
  failed: "failed query",
  empty: "empty reply",
  cutOff: "cut off reply",
  afterClear: "after clear",
} as const;
type Scenario = keyof typeof QUERIES;

const FINAL_ANSWER: Record<Scenario, string> = {
  parallel: "All done.",
  atLimit: "Answered at the limit.",
  overrun: "never sent",
  contents: "Contents handled.",
  refused: "never sent",
  failed: "never sent",
  empty: "never sent",
  cutOff: "Partial reply",
  afterClear: "Fresh start.",
};

/**
 * What the test types, in order: every query, with a blank line (which must not
 * reach the API) and `clear` before the last.
 */
const INPUT = [
  QUERIES.parallel,
  QUERIES.atLimit,
  QUERIES.overrun,
  QUERIES.contents,
  QUERIES.refused,
  QUERIES.failed,
  QUERIES.empty,
  QUERIES.cutOff,
  "",
  "clear",
  QUERIES.afterClear,
  "quit",
];

/** SYSTEM_PROMPT in every client. */
const SYSTEM_PROMPT =
  "You are a helpful assistant. Use the available tools when they help answer the question.";
const REFUSAL_NOTICE = "[The model declined to answer; the query is not kept in history]";
const MAX_TOKENS_NOTICE = "[Reply cut off at the max_tokens limit]";
/** What the fake API says when it fails the failed query. */
const API_ERROR = "prompt is too long";

type Block = Record<string, unknown> & { type: string };
type Message = { role: string; content: string | Block[] };
type Request = {
  model?: string;
  system?: unknown;
  max_tokens?: number;
  tools?: unknown[];
  messages: Message[];
};

const failures: string[] = [];
let passed = 0;
const calls: Record<Scenario, number> = {
  parallel: 0,
  atLimit: 0,
  overrun: 0,
  contents: 0,
  refused: 0,
  failed: 0,
  empty: 0,
  cutOff: 0,
  afterClear: 0,
};

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

/** Whether any text block in the request, at any depth, is empty. */
function hasEmptyText(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasEmptyText);
  if (value === null || typeof value !== "object") return false;
  const block = value as Record<string, unknown>;
  if (block.type === "text" && block.text === "") return true;
  return Object.values(block).some(hasEmptyText);
}

/** Whether a message with this role and this text is in the history. */
function historyHas(messages: Message[], role: string, value: string): boolean {
  return messages.some(
    (message) => message.role === role && textOf(message.content).includes(value),
  );
}

/** Whether a tool_use with this id, and a non-empty result for it, are in the history. */
function toolPairKept(messages: Message[], id: string): boolean {
  const blocks = messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content : [],
  );
  const used = blocks.some((block) => block.type === "tool_use" && block.id === id);
  const result = blocks.find((block) => block.type === "tool_result" && block.tool_use_id === id);
  return used && textOf(result?.content).length > 0;
}

/**
 * Why the API would reject this history, if it would. Consecutive user
 * messages are fine (the API joins them); an unanswered tool_use is not.
 */
function historyProblem(messages: Message[]): string | undefined {
  if (messages[0]?.role !== "user") return "history must start with a user message";
  if (messages[messages.length - 1]?.role !== "user") {
    return "history must end with a user message";
  }
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.content.length === 0) return `message ${i} is empty`;
    if (message.role !== "assistant") continue;
    if (messages[i - 1]?.role === "assistant") return `two assistant messages in a row at ${i}`;
    const blocks = Array.isArray(message.content) ? message.content : [];
    const ids = blocks.filter((block) => block.type === "tool_use").map((block) => block.id);
    if (ids.length === 0) continue;
    const answered = toolResultsOf(messages[i + 1]).map((block) => block.tool_use_id);
    if (ids.sort().join(",") !== answered.sort().join(",")) {
      return `tool_use in message ${i} is not answered by the next message`;
    }
  }
  return undefined;
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

const THINKING: Block = {
  type: "thinking",
  thinking: "Two lookups are needed.",
  signature: "test-signature",
};
const REDACTED_THINKING: Block = { type: "redacted_thinking", data: "test-redacted-data" };

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
    // Thinking comes before the tool calls, as it does from the real model.
    return [
      THINKING,
      REDACTED_THINKING,
      text("Checking two things."),
      toolUse("tu_1", "get_alerts", { state: "CA" }),
      toolUse("tu_2", "get_forecast", { latitude: 38.58, longitude: -121.49 }),
    ];
  }

  if (n === 2) {
    check(messages.length === 3, `${label}: history has 3 messages (got ${messages.length})`);
    check(messages[1]?.role === "assistant", `${label}: assistant turn is kept in history`);
    // The API rejects a follow-up whose assistant turn lost its thinking
    // blocks, so they must be echoed back unchanged.
    const echoed = Array.isArray(messages[1]?.content) ? messages[1].content : [];
    const thinking = echoed.find((block) => block.type === "thinking");
    const redacted = echoed.find((block) => block.type === "redacted_thinking");
    check(
      thinking?.thinking === THINKING.thinking && thinking?.signature === THINKING.signature,
      `${label}: thinking block is passed back with its signature`,
    );
    check(
      redacted?.data === REDACTED_THINKING.data,
      `${label}: redacted thinking block is passed back`,
    );
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
    check(results[0]?.is_error === true, `${label}: error result is forwarded as is_error`);
    return [text(FINAL_ANSWER.parallel)];
  }

  check(false, `${label}: unexpected extra call`);
  return [text("extra")];
}

/**
 * The scripted turn for the tool-result-contents query: one call to each of the
 * mock server's three awkward tools, then an answer.
 */
function respondContents(n: number, request: Request): Block[] {
  const label = `contents call ${n}`;
  const last = request.messages[request.messages.length - 1];

  if (n === 1) {
    check(
      historyHas(request.messages, "user", QUERIES.parallel) &&
        historyHas(request.messages, "assistant", FINAL_ANSWER.parallel),
      `${label}: earlier queries and answers are kept in history`,
    );
    for (const id of ["tu_1", "tu_2", "tu_3"]) {
      check(
        toolPairKept(request.messages, id),
        `${label}: earlier tool call ${id} and its result are kept in history`,
      );
    }
    return [
      toolUse("tc_1", "rejected_call", {}),
      toolUse("tc_2", "structured_only", {}),
      toolUse("tc_3", "non_text", {}),
    ];
  }

  if (n === 2) {
    const results = toolResultsOf(last);
    const byId = (id: string) => results.find((block) => block.tool_use_id === id);
    check(
      results.length === 3,
      `${label}: all three tool_results arrive, the rejected call's too (got ${results.length})`,
    );

    const rejected = byId("tc_1");
    check(rejected?.is_error === true, `${label}: rejected call is forwarded as is_error`);
    check(
      textOf(rejected?.content).length > 0,
      `${label}: rejected call's tool_result says what went wrong`,
    );

    const structured = byId("tc_2");
    check(
      textOf(structured?.content).includes(STRUCTURED_ONLY_VALUE),
      `${label}: structuredContent with only empty text is forwarded as JSON`,
    );

    const nonText = byId("tc_3");
    const blocks = Array.isArray(nonText?.content) ? (nonText.content as Block[]) : [];
    const image = blocks.find((block) => block.type === "image") as
      | { source?: { type?: string; media_type?: string; data?: string } }
      | undefined;
    check(
      image?.source?.type === "base64" &&
        image.source.media_type === "image/png" &&
        image.source.data === IMAGE_DATA,
      `${label}: image block is converted to an Anthropic base64 image`,
    );
    check(
      textOf(nonText?.content).includes(RESOURCE_TEXT),
      `${label}: text resource is forwarded as its text`,
    );
    check(
      textOf(nonText?.content).includes("[unsupported result type: audio]"),
      `${label}: audio block is replaced by a placeholder`,
    );
    return [text(FINAL_ANSWER.contents)];
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

/** A scripted reply, or an error for the fake API to fail the request with. */
type Reply = { content: Block[]; stopReason?: string; error?: string };

function respond(request: Request): Reply {
  const scenario = scenarioOf(request.messages);
  if (!scenario) {
    check(false, "request belongs to a known query");
    return { content: [text("unknown query")] };
  }
  const n = ++calls[scenario];
  const label = `${scenario} call ${n}`;

  check(
    textOf(request.system) === SYSTEM_PROMPT,
    `${label}: system prompt is sent (got ${JSON.stringify(request.system)})`,
  );
  const problem = historyProblem(request.messages);
  check(problem === undefined, `${label}: history is valid (${problem})`);

  check(
    Array.isArray(request.tools) && request.tools.length === MOCK_TOOL_COUNT,
    `${scenario} call ${n}: tools are passed (got ${request.tools?.length ?? "none"})`,
  );
  check(
    !hasEmptyText(request.messages),
    `${scenario} call ${n}: no text block is empty (the API rejects them)`,
  );
  check(
    request.max_tokens === EXPECTED_MAX_TOKENS,
    `${scenario} call ${n}: max_tokens is ${EXPECTED_MAX_TOKENS} (got ${request.max_tokens})`,
  );

  if (scenario === "refused") {
    // A refusal before any output comes back with no content.
    return { content: [], stopReason: "refusal" };
  }
  if (scenario === "failed") {
    // A tool round first, so rolling back must drop more than the query.
    if (n === 1) return { content: [toolUse("rj_1", "get_alerts", { state: "TX" })] };
    return { content: [], error: API_ERROR };
  }
  if (scenario === "empty") {
    return { content: [], stopReason: "end_turn" };
  }
  if (scenario === "cutOff") {
    check(
      !historyHas(request.messages, "user", QUERIES.refused),
      `${label}: the refused query is not kept in history`,
    );
    check(
      !historyHas(request.messages, "user", QUERIES.failed) &&
        !toolPairKept(request.messages, "rj_1"),
      `${label}: the failed query and its tool call are not kept in history`,
    );
    check(
      historyHas(request.messages, "assistant", FINAL_ANSWER.contents),
      `${label}: earlier answers are still kept in history`,
    );
    return { content: [text(FINAL_ANSWER.cutOff)], stopReason: "max_tokens" };
  }
  if (scenario === "afterClear") {
    check(
      request.messages.length === 1,
      `${label}: history is empty after clear (got ${request.messages.length} messages)`,
    );
    return { content: [text(FINAL_ANSWER.afterClear)] };
  }

  if (scenario === "parallel") return { content: respondParallel(n, request) };
  if (scenario === "contents") return { content: respondContents(n, request) };
  return { content: respondTurnLimit(scenario, n, request) };
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
      const { content, stopReason: scripted, error } = respond(request);
      res.setHeader("content-type", "application/json");
      if (error) {
        // 400 rather than 500: the SDKs retry a 500, not a 400.
        res.writeHead(400).end(
          JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: error } }),
        );
        return;
      }
      const stopReason =
        scripted ?? (content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn");
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
    const lines = [...INPUT];
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

  check(calls.contents === 2, `contents: API was called 2 times (got ${calls.contents})`);
  check(stdout.includes(FINAL_ANSWER.contents), "contents: client printed the final answer");

  check(calls.refused === 1, `refused: API was called once (got ${calls.refused})`);
  check(stdout.includes(REFUSAL_NOTICE), "refused: client printed the refusal notice");
  check(calls.failed === 2, `failed: API was called 2 times (got ${calls.failed})`);
  check(stdout.includes(API_ERROR), "failed: client printed the API error");
  check(calls.empty === 1, `empty: API was called once (got ${calls.empty})`);
  check(calls.cutOff === 1, `cut off: API was called once (got ${calls.cutOff})`);
  check(stdout.includes(FINAL_ANSWER.cutOff), "cut off: client printed the partial reply");
  check(stdout.includes(MAX_TOKENS_NOTICE), "cut off: client printed the max_tokens notice");
  check(calls.afterClear === 1, `after clear: API was called once (got ${calls.afterClear})`);
  check(stdout.includes(FINAL_ANSWER.afterClear), "after clear: client printed the answer");
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
