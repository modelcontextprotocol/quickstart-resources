#!/usr/bin/env node
/**
 * Ctrl-C test for clients
 *
 * Every client must treat Ctrl-C like `quit`: stop, shut the MCP server down
 * and exit with status 0. This sends SIGINT to the client twice, in two
 * separate runs:
 *
 *  - "at the prompt": once the client is waiting for a query;
 *  - "during a request": once a query has reached a fake Anthropic API that
 *    never answers.
 *
 * Stdin stays open in both, as in a terminal: a client blocked on a pending
 * read when it tries to exit hangs here, where closing stdin would hide it.
 *
 * Only the client gets the signal. A terminal sends Ctrl-C to the server as
 * well, but the client must not depend on that. The mock server writes its
 * PID to a file, so the test can check that the server is gone afterwards.
 *
 * Usage: node interrupt-test.js <client command> [args...] <mock server path>
 * The client command must end with the mock server's path; the test adds the
 * PID file argument after it.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/** Every client prints this before reading a query. */
const PROMPT = "Query: ";
/** How long a client may take to exit after SIGINT. */
const EXIT_TIMEOUT_MS = 10_000;
/** How long a client may take to start and show its prompt. */
const START_TIMEOUT_MS = 120_000;
/** How long the mock server may outlive the client. */
const SERVER_EXIT_MS = 2_000;

type Scenario = "at the prompt" | "during a request";

const failures: string[] = [];

/** A fake Messages API that takes every request and never answers it. */
function startHangingApi(onRequest: () => void): Promise<http.Server> {
  const server = http.createServer((req) => {
    req.resume();
    req.on("end", onRequest);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function serverExited(pidFile: string): Promise<string | undefined> {
  let pid: number;
  try {
    pid = Number(readFileSync(pidFile, "utf8"));
  } catch {
    return "the mock server never wrote its PID";
  }
  const deadline = Date.now() + SERVER_EXIT_MS;
  while (isRunning(pid)) {
    if (Date.now() > deadline) {
      process.kill(pid, "SIGKILL");
      return `the mock server (PID ${pid}) was still running ${SERVER_EXIT_MS / 1000}s after the client exited`;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

async function run(scenario: Scenario, command: string, args: string[]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "interrupt-test-"));
  const pidFile = path.join(dir, "server.pid");

  let interrupt = () => {};
  const api = await startHangingApi(() => {
    if (scenario === "during a request") interrupt();
  });
  const address = api.address();
  if (!address || typeof address === "string") throw new Error("no port");

  const child = spawn(command, [...args, pidFile], {
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      ANTHROPIC_API_KEY: "test-key",
    },
    stdio: ["pipe", "pipe", "pipe"],
    // Its own process group, so a client that hangs can be killed together
    // with everything it started. SIGINT still goes to the client alone.
    detached: true,
  });
  const killAll = () => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      // already gone
    }
  };
  let stdout = "";
  let stderr = "";
  let sentAt = 0;
  interrupt = () => {
    if (sentAt) return;
    sentAt = Date.now();
    child.kill("SIGINT");
  };

  child.stdout.on("data", (chunk) => {
    const first = !stdout.includes(PROMPT);
    stdout += chunk;
    if (!first || !stdout.includes(PROMPT)) return;
    if (scenario === "at the prompt") {
      // Give the client a moment to start reading.
      setTimeout(interrupt, 300);
    } else {
      child.stdin.write("what's the weather?\n");
    }
  });
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const timer = setTimeout(killAll, START_TIMEOUT_MS);
  const exitTimer = setInterval(() => {
    if (sentAt && Date.now() - sentAt > EXIT_TIMEOUT_MS) killAll();
  }, 200);

  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    child.on("error", (error) => {
      failures.push(`${scenario}: could not start client: ${error.message}`);
      resolve([null, null]);
    });
    // "exit", not "close": a server left running can hold the client's pipes
    // open, and the server check below must still run.
    child.on("exit", (code, signal) => resolve([code, signal]));
  });
  clearTimeout(timer);
  clearInterval(exitTimer);
  api.closeAllConnections();
  api.close();

  const before = failures.length;
  if (!sentAt) {
    failures.push(`${scenario}: the client exited before the test could send SIGINT`);
  } else if (signal === "SIGKILL") {
    failures.push(`${scenario}: the client was still running ${EXIT_TIMEOUT_MS / 1000}s after SIGINT`);
  } else if (code !== 0) {
    failures.push(`${scenario}: the client exited with ${signal ? `signal ${signal}` : `status ${code}`}, not 0`);
  }
  const serverProblem = await serverExited(pidFile);
  if (serverProblem) failures.push(`${scenario}: ${serverProblem}`);
  rmSync(dir, { recursive: true, force: true });

  if (failures.length > before) {
    console.error(`--- ${scenario}: client stdout ---\n${stdout.trim()}`);
    console.error(`--- ${scenario}: client stderr ---\n${stderr.trim()}`);
  } else {
    console.error(`✓ ${scenario}: exited 0 in ${Date.now() - sentAt}ms, server shut down`);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || args.length === 0) {
    console.error("Usage: node interrupt-test.js <client command> [args...] <mock server path>");
    process.exit(1);
  }
  console.error(`Testing Ctrl-C: ${command} ${args.join(" ")}`);

  await run("at the prompt", command, args);
  await run("during a request", command, args);

  if (failures.length === 0) return;
  console.error(`✗ Ctrl-C test failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

main().catch((error) => {
  console.error("✗ Ctrl-C test crashed:", error);
  process.exit(1);
});
