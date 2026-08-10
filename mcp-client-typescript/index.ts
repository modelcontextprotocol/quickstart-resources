import { Anthropic } from "@anthropic-ai/sdk";
import {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";

import dotenv from "dotenv";

dotenv.config(); // load environment variables from .env

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const MAX_TOOL_TURNS = 10;

class MCPClient {
  private mcp: Client;
  private _anthropic: Anthropic | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];

  constructor() {
    // Initialize MCP client
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
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
    const messages: MessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    let response = await this.anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });

    const finalText: string[] = [];

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const toolUses: ToolUseBlock[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          finalText.push(block.text);
        } else if (block.type === "tool_use") {
          toolUses.push(block);
        }
      }

      if (toolUses.length === 0) {
        return finalText.join("\n");
      }

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const toolArgs = toolUse.input as { [x: string]: unknown } | undefined;
        finalText.push(
          `[Calling tool ${toolUse.name} with args ${JSON.stringify(toolArgs)}]`,
        );
        const result = await this.mcp.callTool({
          name: toolUse.name,
          arguments: toolArgs,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.content as ToolResultBlockParam["content"],
        });
      }

      messages.push({
        role: "assistant",
        content: response.content as unknown as ContentBlockParam[],
      });
      messages.push({ role: "user", content: toolResults });

      response = await this.anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        messages,
        tools: this.tools,
      });
    }

    finalText.push(`[Stopped after ${MAX_TOOL_TURNS} tool-use turns]`);
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
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        let message: string;
        try {
          message = await rl.question("\nQuery: ", { signal: ac.signal });
        } catch {
          break;
        }

        if (message.toLowerCase() === "quit") break;

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
