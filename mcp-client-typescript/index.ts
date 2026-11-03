import Anthropic from "@anthropic-ai/sdk";

import { Client, ProtocolError } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import readline from "readline/promises";

import dotenv from "dotenv";

dotenv.config({ quiet: true }); // load environment variables from .env

const ANTHROPIC_MODEL = "claude-sonnet-5";
// Sonnet 5 thinks adaptively unless told otherwise, and max_tokens caps thinking
// plus the reply, so leave room for both.
const MAX_TOKENS = 10000;
const MAX_TOOL_TURNS = 10;
const SYSTEM_PROMPT =
  "You are a helpful assistant. Use the available tools when they help answer the question.";

type ImageMediaType = Anthropic.Base64ImageSource["media_type"];
// Image types the Messages API accepts.
const SUPPORTED_IMAGE_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] satisfies ImageMediaType[]);

/**
 * Translate an MCP tool result into content for an Anthropic tool_result.
 *
 * MCP and Anthropic content blocks differ, so each kind is converted. A kind
 * the model cannot take becomes a placeholder rather than vanishing, so the
 * model knows something was there.
 */
function toolResultContent(
  result: CallToolResult,
): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  let content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
  for (const block of result.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "image" && SUPPORTED_IMAGE_TYPES.has(block.mimeType)) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: block.mimeType as ImageMediaType,
          data: block.data,
        },
      });
    } else if (block.type === "resource" && "text" in block.resource) {
      content.push({ type: "text", text: block.resource.text });
    } else {
      content.push({ type: "text", text: `[unsupported result type: ${block.type}]` });
    }
  }

  content = content.filter((block) => block.type !== "text" || block.text !== "");
  if (
    result.structuredContent !== undefined &&
    !result.content.some((block) => block.type === "text" && block.text !== "")
  ) {
    content.push({ type: "text", text: JSON.stringify(result.structuredContent) });
  }

  return content;
}

class MCPClient {
  private mcp: Client;
  private _anthropic: Anthropic | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: Anthropic.Tool[] = [];
  private messages: Anthropic.MessageParam[] = [];

  constructor() {
    // 'auto' probes server/discover, falling back to the 2025-11-25 handshake.
    // The SDK's default is 'legacy'.
    this.mcp = new Client(
      { name: "mcp-client-cli", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
  }

  private get anthropic(): Anthropic {
    // Lazy-initialize Anthropic client when needed
    return this._anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async connectToServer(serverScriptPath: string) {
    /**
     * Connect to an MCP server
     *
     * @param serverScriptPath - Path to the server script (.py or .js)
     */
    try {
      // Determine script type and appropriate command
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file");
      }
      const command = isPy
        ? process.platform === "win32"
          ? "python"
          : "python3"
        : process.execPath;

      // Initialize transport and connect to server
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });
      await this.mcp.connect(this.transport);

      // List available tools
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
      console.log(
        "Connected to server with tools:",
        this.tools.map(({ name }) => name),
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async processQuery(query: string) {
    /**
     * Process a query using Claude and available tools
     *
     * @param query - The user's input query
     * @returns Processed response as a string
     */
    const historyLength = this.messages.length;
    this.messages.push({ role: "user", content: query });
    const finalText: string[] = [];

    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
      const response = await this.anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: this.messages,
        tools: this.tools,
      });

      if (response.stop_reason === "refusal") {
        // Drop the refused query so a follow-up doesn't send it again.
        this.messages.length = historyLength;
        finalText.push("[The model declined to answer; the query is not kept in history]");
        break;
      }

      for (const block of response.content) {
        if (block.type === "text") finalText.push(block.text);
      }

      if (response.stop_reason === "max_tokens") {
        finalText.push("[Reply cut off at the max_tokens limit]");
        break;
      }
      if (response.stop_reason !== "tool_use") {
        this.messages.push({ role: "assistant", content: response.content });
        break;
      }
      if (turn === MAX_TOOL_TURNS) {
        finalText.push(`[Stopped after ${MAX_TOOL_TURNS} tool-use turns]`);
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of response.content) {
        if (toolUse.type !== "tool_use") continue;
        const toolArgs = toolUse.input as { [x: string]: unknown } | undefined;
        finalText.push(
          `[Calling tool ${toolUse.name} with args ${JSON.stringify(toolArgs)}]`,
        );
        let result: CallToolResult;
        try {
          // callTool validates the result against the declared schema.
          result = await this.mcp.callTool({
            name: toolUse.name,
            arguments: toolArgs,
          });
        } catch (error) {
          if (!(error instanceof ProtocolError)) throw error;
          // A rejected call is the model's mistake to correct, so it goes back
          // as a failed tool_result rather than ending the query. Every
          // tool_use still needs a matching result.
          finalText.push(`[${toolUse.name} failed: ${error.message}]`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Tool call ${toolUse.name} failed: ${error.message}`,
            is_error: true,
          });
          continue;
        }

        // structuredContent is data the application can use directly.
        if (Array.isArray(result.structuredContent)) {
          finalText.push(
            `[${toolUse.name} returned ${result.structuredContent.length} items]`,
          );
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: toolResultContent(result),
          is_error: result.isError === true,
        });
      }

      this.messages.push({ role: "assistant", content: response.content });
      this.messages.push({ role: "user", content: toolResults });
    }

    return finalText.join("\n");
  }

  async chatLoop() {
    /**
     * Run an interactive chat loop
     */
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // rl.question() doesn't reject on stdin EOF on its own; wire its close
    // event to an AbortSignal so EOF (Ctrl-D) and SIGINT both unblock it.
    const ac = new AbortController();
    const onClose = () => ac.abort();
    rl.on("close", onClose);
    const onSigint = () => rl.close();
    process.once("SIGINT", onSigint);

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your queries, 'clear' to forget the conversation, or 'quit' to exit.");

      while (true) {
        let message: string;
        try {
          message = await rl.question("\nQuery: ", { signal: ac.signal });
        } catch {
          break;
        }

        if (message.toLowerCase() === "quit") break;
        if (!message.trim()) continue;
        if (message.toLowerCase() === "clear") {
          this.messages = [];
          console.log("\nConversation cleared.");
          continue;
        }

        try {
          const response = await this.processQuery(message);
          console.log("\n" + response);
        } catch (e) {
          console.log(`\nError: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      process.off("SIGINT", onSigint);
      rl.off("close", onClose);
      rl.close();
    }
  }

  async cleanup() {
    /**
     * Clean up resources
     */
    await this.mcp.close();
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log("Usage: node build/index.js <path_to_server_script>");
    return;
  }
  const mcpClient = new MCPClient();
  try {
    await mcpClient.connectToServer(process.argv[2]);

    // Check if we have a valid API key to continue
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log(
        "\nNo ANTHROPIC_API_KEY found. To query these tools with Claude, set your API key:"
      );
      console.log("  export ANTHROPIC_API_KEY=your-api-key-here");
      return;
    }

    await mcpClient.chatLoop();
  } catch (e) {
    console.error("Error:", e);
    await mcpClient.cleanup();
    process.exit(1);
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
