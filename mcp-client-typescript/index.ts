import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import { access } from "fs/promises";
import { constants } from "fs";

import dotenv from "dotenv";

dotenv.config(); // load environment variables from .env

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

class MCPClient {
  private mcp: Client;
  private anthropic: Anthropic;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];

  constructor() {
    // Initialize Anthropic client and MCP client
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }

  async connectToServer(serverScriptPath: string, timeoutMs: number = 30000) {
    /**
     * Connect to an MCP server
     *
     * @param serverScriptPath - Path to the server script (.py or .js)
     * @param timeoutMs - Connection timeout in milliseconds (default: 30000)
     */
    try {
      // Check if the server script file exists
      try {
        await access(serverScriptPath, constants.F_OK | constants.R_OK);
      } catch {
        throw new Error(
          `Server script not found or not readable: ${serverScriptPath}`
        );
      }

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

      // Initialize transport and connect to server with timeout
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });

      // Wrap connection and tool listing with timeout
      const connectionPromise = (async () => {
        await this.mcp.connect(this.transport!);

        // List available tools
        const toolsResult = await this.mcp.listTools();
        this.tools = toolsResult.tools.map((tool) => {
          return {
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          };
        });
      })();

      await Promise.race([
        connectionPromise,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Connection timeout: Server did not respond within ${timeoutMs}ms`
                )
              ),
            timeoutMs
          )
        ),
      ]);

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
     * Implements a proper agentic loop that handles multiple tool calls
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

    // Agentic loop: continue until Claude stops requesting tools
    while (response.stop_reason === "tool_use") {
      // Add assistant's response to conversation history
      messages.push({
        role: "assistant",
        content: response.content,
      });

      // Collect all tool uses from this turn
      const toolUses = response.content.filter(
        (block) => block.type === "tool_use"
      );

      // Execute all tool calls and collect results
      const toolResults = await Promise.all(
        toolUses.map(async (toolUse) => {
          if (toolUse.type !== "tool_use") return null;

          try {
            console.log(
              `[Calling tool: ${toolUse.name} with args: ${JSON.stringify(toolUse.input)}]`
            );

            const result = await this.mcp.callTool({
              name: toolUse.name,
              arguments: toolUse.input as { [x: string]: unknown } | undefined,
            });

            // Format tool result according to Anthropic's API
            return {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: JSON.stringify(result.content),
            };
          } catch (error) {
            console.error(`[Tool ${toolUse.name} failed: ${error}]`);
            // Return error as tool result
            return {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
              is_error: true,
            };
          }
        })
      );

      // Filter out any null results and add tool results to conversation
      const validToolResults = toolResults.filter((r) => r !== null);
      messages.push({
        role: "user",
        content: validToolResults,
      });

      // Get Claude's next response
      response = await this.anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        messages,
        tools: this.tools,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter(
      (block) => block.type === "text"
    );
    return textBlocks.map((block) => block.text).join("\n");
  }

  async chatLoop() {
    /**
     * Run an interactive chat loop
     */
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
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
