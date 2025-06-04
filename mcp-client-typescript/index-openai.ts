import OpenAI from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import readline from 'readline/promises';
import dotenv from 'dotenv';

dotenv.config(); // load environment variables from .env

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

class MCPClientOpenAI {
  private mcp: Client;
  private openai: OpenAI;
  private transport: StdioClientTransport | null = null;
  private tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

  constructor() {
    // Initialize OpenAI client and MCP client
    this.openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
    this.mcp = new Client({ name: 'mcp-client-openai', version: '1.0.0' });
  }

  async connectToServer(serverScriptPath: string) {
    /**
     * Connect to an MCP server
     *
     * @param serverScriptPath - Path to the server script (.py or .js)
     */
    try {
      // Determine script type and appropriate command
      const isJs = serverScriptPath.endsWith('.js');
      const isPy = serverScriptPath.endsWith('.py');
      if (!isJs && !isPy) {
        throw new Error('Server script must be a .js or .py file');
      }
      const command = isPy
        ? process.platform === 'win32'
          ? 'python'
          : 'python3'
        : process.execPath;

      // Initialize transport and connect to server
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });
      this.mcp.connect(this.transport);

      // List available tools and convert to OpenAI format
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as Record<string, any>,
          },
        };
      });
      console.log(
        'Connected to server with tools:',
        this.tools.map((tool) => tool.function.name)
      );
    } catch (e) {
      console.log('Failed to connect to MCP server: ', e);
      throw e;
    }
  }

  async processQuery(query: string) {
    /**
     * Process a query using OpenAI GPT and available tools
     *
     * @param query - The user's input query
     * @returns Processed response as a string
     */
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: query,
      },
    ];

    // Initial OpenAI API call
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1000,
      messages,
      tools: this.tools,
      tool_choice: 'auto',
    });

    const finalText = [];
    const message = response.choices[0]?.message;

    if (!message) {
      return 'No response from OpenAI';
    }

    // Add assistant message to conversation
    messages.push(message);

    // Handle text response
    if (message.content) {
      finalText.push(message.content);
    }

    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        finalText.push(
          `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
        );

        try {
          // Execute tool call via MCP
          const result = await this.mcp.callTool({
            name: toolName,
            arguments: toolArgs,
          });

          // Add tool result to conversation
          const toolMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam =
            {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: Array.isArray(result.content)
                ? result.content
                    .map((c) =>
                      c.type === 'text' ? c.text : JSON.stringify(c)
                    )
                    .join('\n')
                : typeof result.content === 'string'
                ? result.content
                : JSON.stringify(result.content),
            };
          messages.push(toolMessage);
        } catch (error) {
          // Handle tool execution error
          const errorMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam =
            {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error executing tool: ${error}`,
            };
          messages.push(errorMessage);
        }
      }

      // Get final response from OpenAI after tool execution
      const finalResponse = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages,
      });

      const finalMessage = finalResponse.choices[0]?.message;
      if (finalMessage?.content) {
        finalText.push(finalMessage.content);
      }
    }

    return finalText.join('\n');
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
      console.log('\nMCP Client with OpenAI Started!');
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question('\nQuery: ');
        if (message.toLowerCase() === 'quit') {
          break;
        }
        try {
          const response = await this.processQuery(message);
          console.log('\n' + response);
        } catch (error) {
          console.error('Error processing query:', error);
        }
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
    console.log('Usage: node build/index-openai.js <path_to_server_script>');
    return;
  }
  const mcpClient = new MCPClientOpenAI();
  try {
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
