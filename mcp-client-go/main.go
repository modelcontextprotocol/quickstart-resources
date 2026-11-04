package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/google/jsonschema-go/jsonschema"
	"github.com/joho/godotenv"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var model = anthropic.ModelClaudeSonnet5

// Sonnet 5 thinks adaptively unless told otherwise, and max_tokens caps thinking
// plus the reply, so leave room for both.
const maxTokens = 10000
const maxToolTurns = 10
const systemPrompt = "You are a helpful assistant. Use the available tools when they help answer the question."

// Image types the Messages API accepts.
var supportedImageTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

// toolResultContent translates an MCP tool result into content for an
// Anthropic tool_result.
//
// MCP and Anthropic content blocks differ, so each kind is converted. A kind
// the model cannot take becomes a placeholder rather than vanishing, so the
// model knows something was there.
func toolResultContent(result *mcp.CallToolResult) []anthropic.ToolResultBlockParamContentUnion {
	var content []anthropic.ToolResultBlockParamContentUnion
	text := func(s string) {
		if s == "" {
			return
		}
		content = append(content, anthropic.ToolResultBlockParamContentUnion{OfText: &anthropic.TextBlockParam{Text: s}})
	}

	hasText := false
	for _, block := range result.Content {
		switch b := block.(type) {
		case *mcp.TextContent:
			hasText = hasText || b.Text != ""
			text(b.Text)
		case *mcp.ImageContent:
			if !supportedImageTypes[b.MIMEType] {
				text("[unsupported result type: image]")
				continue
			}
			content = append(content, anthropic.ToolResultBlockParamContentUnion{OfImage: &anthropic.ImageBlockParam{
				Source: anthropic.ImageBlockParamSourceUnion{OfBase64: &anthropic.Base64ImageSourceParam{
					// The SDK holds the decoded bytes; the API wants base64.
					Data:      base64.StdEncoding.EncodeToString(b.Data),
					MediaType: anthropic.Base64ImageSourceMediaType(b.MIMEType),
				}},
			}})
		case *mcp.EmbeddedResource:
			if b.Resource == nil || b.Resource.Blob != nil {
				text("[unsupported result type: resource]")
				continue
			}
			text(b.Resource.Text)
		default:
			text(fmt.Sprintf("[unsupported result type: %s]", contentType(block)))
		}
	}

	// A structured result SHOULD also carry serialized JSON in a text block, but
	// only SHOULD, so serialize it when no text came with it.
	if !hasText && result.StructuredContent != nil {
		if data, err := json.Marshal(result.StructuredContent); err == nil {
			text(string(data))
		}
	}

	return content
}

// contentType returns an MCP content block's wire type, such as "audio".
func contentType(block mcp.Content) string {
	var wire struct {
		Type string `json:"type"`
	}
	if data, err := block.MarshalJSON(); err == nil && json.Unmarshal(data, &wire) == nil && wire.Type != "" {
		return wire.Type
	}
	return "unknown"
}

type MCPClient struct {
	anthropic *anthropic.Client
	session   *mcp.ClientSession
	tools     []anthropic.ToolUnionParam
	messages  []anthropic.MessageParam
	// Compiled outputSchema per tool name, for validating results.
	outputSchemas map[string]*jsonschema.Resolved
}

func NewMCPClient() (*MCPClient, error) {
	// .env is optional; the key may come from the environment instead.
	_ = godotenv.Load()

	client := anthropic.NewClient(option.WithAPIKey(os.Getenv("ANTHROPIC_API_KEY")))

	return &MCPClient{
		anthropic: &client,
	}, nil
}

func (c *MCPClient) ConnectToServer(ctx context.Context, serverArgs []string) error {
	if len(serverArgs) == 0 {
		return fmt.Errorf("no server command provided")
	}

	// Create command to spawn server process
	cmd := exec.CommandContext(ctx, serverArgs[0], serverArgs[1:]...)

	// Create MCP client
	client := mcp.NewClient(
		&mcp.Implementation{
			Name:    "mcp-client-go",
			Version: "0.1.0",
		},
		nil,
	)

	// Connect using CommandTransport
	transport := &mcp.CommandTransport{
		Command: cmd,
	}

	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to server: %w", err)
	}

	c.session = session

	// List available tools
	toolsResult, err := session.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		return fmt.Errorf("failed to list tools: %w", err)
	}

	var toolNames []string

	// Convert MCP tools to Anthropic tool format
	c.outputSchemas = make(map[string]*jsonschema.Resolved)
	for _, tool := range toolsResult.Tools {
		toolNames = append(toolNames, tool.Name)
		anthropicTool, err := mcpToolToAnthropicTool(tool)
		if err != nil {
			return fmt.Errorf("failed to convert mcp tool to anthropic tool: %w", err)
		}
		c.tools = append(c.tools, anthropicTool)

		resolved, err := resolveOutputSchema(tool)
		if err != nil {
			return fmt.Errorf("failed to compile output schema of tool %s: %w", tool.Name, err)
		}
		if resolved != nil {
			c.outputSchemas[tool.Name] = resolved
		}
	}

	fmt.Printf("Connected to server with tools: %v\n", toolNames)
	return nil
}

func mcpToolToAnthropicTool(tool *mcp.Tool) (anthropic.ToolUnionParam, error) {
	var zeroTool anthropic.ToolUnionParam
	schemaJSON, err := json.Marshal(tool.InputSchema)
	if err != nil {
		return zeroTool, fmt.Errorf("failed to marshal input schema of mcp tool: %w", err)
	}
	var schema anthropic.ToolInputSchemaParam
	err = json.Unmarshal(schemaJSON, &schema)
	if err != nil {
		return zeroTool, fmt.Errorf("failed to unmarshal to anthropic input schema: %w", err)
	}

	toolParam := anthropic.ToolParam{
		Name:        tool.Name,
		Description: anthropic.String(tool.Description),
		InputSchema: schema,
	}

	return anthropic.ToolUnionParam{
		OfTool: &toolParam,
	}, nil
}

// resolveOutputSchema compiles a tool's declared outputSchema, or returns
// (nil, nil) when it declares none. OutputSchema is `any` because the root may
// be any JSON Schema, so round-trip through JSON to accept every form.
func resolveOutputSchema(tool *mcp.Tool) (*jsonschema.Resolved, error) {
	if tool.OutputSchema == nil {
		return nil, nil
	}
	raw, err := json.Marshal(tool.OutputSchema)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal output schema: %w", err)
	}
	var schema jsonschema.Schema
	if err := json.Unmarshal(raw, &schema); err != nil {
		return nil, fmt.Errorf("failed to unmarshal output schema: %w", err)
	}
	return schema.Resolve(nil)
}

// validateToolOutput checks a result against its tool's declared outputSchema.
// Error results are exempt: they carry a message, not data.
func (c *MCPClient) validateToolOutput(name string, result *mcp.CallToolResult) error {
	resolved, ok := c.outputSchemas[name]
	if !ok || result.IsError {
		return nil
	}
	if result.StructuredContent == nil {
		return fmt.Errorf("tool %s declares an output schema but returned no structured content", name)
	}
	if err := resolved.Validate(result.StructuredContent); err != nil {
		return fmt.Errorf("structured content from tool %s does not match its output schema: %w", name, err)
	}
	return nil
}

func (c *MCPClient) ProcessQuery(ctx context.Context, query string) (string, error) {
	if c.session == nil {
		return "", fmt.Errorf("client is not connected to any server")
	}

	historyLength := len(c.messages)
	c.messages = append(c.messages, anthropic.NewUserMessage(anthropic.NewTextBlock(query)))
	var finalText []string

	for turn := 0; turn <= maxToolTurns; turn++ {
		// Tools are passed on every call so Claude can keep calling them.
		response, err := c.anthropic.Messages.New(ctx, anthropic.MessageNewParams{
			Model:     model,
			MaxTokens: maxTokens,
			System:    []anthropic.TextBlockParam{{Text: systemPrompt}},
			Messages:  c.messages,
			Tools:     c.tools,
		})
		if err != nil {
			return "", fmt.Errorf("anthropic API request failed: %w", err)
		}

		if response.StopReason == anthropic.StopReasonRefusal {
			// Drop the refused query so a follow-up doesn't send it again.
			c.messages = c.messages[:historyLength]
			finalText = append(finalText, "[The model declined to answer; the query is not kept in history]")
			break
		}

		for _, block := range response.Content {
			if b, ok := block.AsAny().(anthropic.TextBlock); ok {
				finalText = append(finalText, b.Text)
			}
		}

		if response.StopReason == anthropic.StopReasonMaxTokens {
			finalText = append(finalText, "[Reply cut off at the max_tokens limit]")
			break
		}
		if response.StopReason != anthropic.StopReasonToolUse {
			// The API rejects an empty assistant message, so an empty reply isn't kept.
			if len(response.Content) > 0 {
				c.messages = append(c.messages, response.ToParam())
			}
			break
		}
		if turn == maxToolTurns {
			finalText = append(finalText, fmt.Sprintf("[Stopped after %d tool-use turns]", maxToolTurns))
			break
		}

		// Execute every tool call in this response and collect the results
		var anthropicToolResults []anthropic.ContentBlockParamUnion
		for _, block := range response.Content {
			toolUseBlock, ok := block.AsAny().(anthropic.ToolUseBlock)
			if !ok {
				continue
			}
			// Add information about the tool call to final text
			finalText = append(finalText, fmt.Sprintf("[Calling tool %s with args %s]", toolUseBlock.Name, string(toolUseBlock.Input)))

			// Call the MCP server tool
			mcpToolResult, err := c.session.CallTool(ctx, &mcp.CallToolParams{
				Name:      toolUseBlock.Name,
				Arguments: toolUseBlock.Input,
			})
			if err != nil {
				// A rejected call is the model's mistake to correct, so it goes
				// back as a failed tool_result rather than ending the query.
				// Every tool_use still needs a matching result.
				finalText = append(finalText, fmt.Sprintf("[%s failed: %v]", toolUseBlock.Name, err))
				anthropicToolResults = append(anthropicToolResults, anthropic.NewToolResultBlock(
					toolUseBlock.ID,
					fmt.Sprintf("Tool call %s failed: %v", toolUseBlock.Name, err),
					true,
				))
				continue
			}

			if err := c.validateToolOutput(toolUseBlock.Name, mcpToolResult); err != nil {
				return "", err
			}

			// StructuredContent is data the application can use directly.
			if items, ok := mcpToolResult.StructuredContent.([]any); ok {
				finalText = append(finalText, fmt.Sprintf("[%s returned %d items]", toolUseBlock.Name, len(items)))
			}

			anthropicToolResults = append(anthropicToolResults, anthropic.ContentBlockParamUnion{
				OfToolResult: &anthropic.ToolResultBlockParam{
					ToolUseID: toolUseBlock.ID,
					Content:   toolResultContent(mcpToolResult),
					IsError:   anthropic.Bool(mcpToolResult.IsError),
				},
			})
		}

		// Every tool_use needs a matching tool_result, all in one user message.
		c.messages = append(c.messages, response.ToParam())
		c.messages = append(c.messages, anthropic.NewUserMessage(anthropicToolResults...))
	}

	return strings.Join(finalText, "\n"), nil
}

func (c *MCPClient) ChatLoop(ctx context.Context) error {
	fmt.Println("\nMCP Client Started!")
	fmt.Println("Type your queries, 'clear' to forget the conversation, or 'quit' to exit.")

	scanner := bufio.NewScanner(os.Stdin)

	for {
		fmt.Print("\nQuery: ")
		if !scanner.Scan() {
			break // EOF
		}

		query := strings.TrimSpace(scanner.Text())
		if strings.EqualFold(query, "quit") {
			break
		}
		if strings.EqualFold(query, "clear") {
			c.messages = nil
			fmt.Println("\nConversation cleared.")
			continue
		}
		if query == "" {
			continue
		}

		historyLength := len(c.messages)
		response, err := c.ProcessQuery(ctx, query)
		if err != nil {
			// Drop the failed query so a follow-up doesn't send it again.
			c.messages = c.messages[:historyLength]
			fmt.Printf("\nError: %v\n", err)
			continue
		}

		fmt.Printf("\n%s\n", response)
	}

	return scanner.Err()
}

func (c *MCPClient) Cleanup() error {
	if c.session != nil {
		if err := c.session.Close(); err != nil {
			return fmt.Errorf("failed to close session: %w", err)
		}
		c.session = nil
	}
	return nil
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: go run main.go <server_script_or_binary> [args...]")
		os.Exit(1)
	}

	serverArgs := os.Args[1:]

	client, err := NewMCPClient()
	if err != nil {
		log.Fatalf("Failed to create MCP client: %v", err)
	}

	ctx := context.Background()

	if err := client.ConnectToServer(ctx, serverArgs); err != nil {
		log.Fatalf("Failed to connect to MCP server: %v", err)
	}

	// Connecting and listing tools needs no credentials; querying them does.
	// Matching the Python and TypeScript clients, report and exit rather than
	// failing, so the connection itself can be exercised without a key.
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		fmt.Println("\nNo ANTHROPIC_API_KEY found. To query these tools with Claude, set your API key:")
		fmt.Println("  export ANTHROPIC_API_KEY=your-api-key-here")
		if err := client.Cleanup(); err != nil {
			log.Printf("Cleanup error: %v", err)
		}
		return
	}

	if err := client.ChatLoop(ctx); err != nil {
		log.Printf("ChatLoop error: %v", err)
	}

	if err := client.Cleanup(); err != nil {
		log.Printf("Cleanup error: %v", err)
	}
}
