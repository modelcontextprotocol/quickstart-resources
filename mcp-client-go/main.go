package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/joho/godotenv"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var model anthropic.Model = anthropic.ModelClaudeSonnet4_5_20250929

type MCPClient struct {
	anthropic *anthropic.Client
	session   *mcp.ClientSession
	tools     []anthropic.ToolUnionParam
}

func NewMCPClient() (*MCPClient, error) {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		return nil, fmt.Errorf("failed to load .env file: %w", err)
	}

	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("ANTHROPIC_API_KEY environment variable not set")
	}

	client := anthropic.NewClient(option.WithAPIKey(apiKey))

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
	for _, tool := range toolsResult.Tools {
		toolNames = append(toolNames, tool.Name)
		anthropicTool, err := mcpToolToAnthropicTool(tool)
		if err != nil {
			return fmt.Errorf("failed to convert mcp tool to anthropic tool: %w", err)
		}
		c.tools = append(c.tools, anthropicTool)
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

func (c *MCPClient) ProcessQuery(ctx context.Context, query string) (string, error) {
	if c.session == nil {
		return "", fmt.Errorf("client is not connected to any server")
	}

	messages := []anthropic.MessageParam{
		anthropic.NewUserMessage(anthropic.NewTextBlock(query)),
	}

	// Initial Claude API call with tools
	response, err := c.anthropic.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     model,
		MaxTokens: 1024,
		Messages:  messages,
		Tools:     c.tools,
	})
	if err != nil {
		return "", fmt.Errorf("anthropic API request failed: %w", err)
	}

	var toolUseBlocks []anthropic.ToolUseBlock
	var finalText []string
	for _, block := range response.Content {
		switch b := block.AsAny().(type) {
		case anthropic.TextBlock:
			finalText = append(finalText, b.Text)
		case anthropic.ToolUseBlock:
			toolUseBlocks = append(toolUseBlocks, b)
		}
	}

	if len(toolUseBlocks) == 0 {
		return strings.Join(finalText, "\n"), nil
	}

	// Append assistant's response to message history
	messages = append(messages, response.ToParam())

	// Execute each tool call and collect responses
	var anthropicToolResults []anthropic.ContentBlockParamUnion
	for _, toolUseBlock := range toolUseBlocks {
		// Add information about the tool call to final text
		finalText = append(finalText, fmt.Sprintf("[Calling tool %s with args %s]", toolUseBlock.Name, string(toolUseBlock.Input)))

		// Call the MCP server tool
		mcpToolResult, err := c.session.CallTool(ctx, &mcp.CallToolParams{
			Name:      toolUseBlock.Name,
			Arguments: toolUseBlock.Input,
		})
		if err != nil {
			return "", fmt.Errorf("tool call %s failed: %w", toolUseBlock.Name, err)
		}

		// Serialize tool result
		resultJSON, err := json.Marshal(mcpToolResult)
		if err != nil {
			return "", fmt.Errorf("failed to serialize tool result: %w", err)
		}

		anthropicToolResults = append(anthropicToolResults, anthropic.NewToolResultBlock(
			toolUseBlock.ID,
			string(resultJSON),
			false,
		))
	}

	// Append tool responses to message history
	messages = append(messages, anthropic.NewUserMessage(anthropicToolResults...))

	// Make another API call with tool results
	response, err = c.anthropic.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.ModelClaude3_7SonnetLatest,
		MaxTokens: 1024,
		Messages:  messages,
	})
	if err != nil {
		return "", fmt.Errorf("anthropic API request with tool results failed: %w", err)
	}

	// Collect text from final response
	for _, block := range response.Content {
		switch b := block.AsAny().(type) {
		case anthropic.TextBlock:
			finalText = append(finalText, b.Text)
		}
	}

	return strings.Join(finalText, "\n"), nil
}

func (c *MCPClient) ChatLoop(ctx context.Context) error {
	fmt.Println("\nMCP Client Started!")
	fmt.Println("Type your queries or 'quit' to exit.")

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
		if query == "" {
			continue
		}

		response, err := c.ProcessQuery(ctx, query)
		if err != nil {
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

	if err := client.ChatLoop(ctx); err != nil {
		log.Printf("ChatLoop error: %v", err)
	}

	if err := client.Cleanup(); err != nil {
		log.Printf("Cleanup error: %v", err)
	}
}
