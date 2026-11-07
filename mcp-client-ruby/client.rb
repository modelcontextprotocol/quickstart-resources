# frozen_string_literal: true

require "anthropic"
require "dotenv/load"
require "json"
require "mcp"

class MCPClient
  ANTHROPIC_MODEL = "claude-sonnet-5"
  # Sonnet 5 thinks adaptively unless told otherwise, and max_tokens caps thinking
  # plus the reply, so leave room for both.
  MAX_TOKENS = 10000
  MAX_TOOL_TURNS = 10
  SYSTEM_PROMPT = "You are a helpful assistant. Use the available tools when they help answer the question."
  # Image types the Messages API accepts.
  SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"].freeze

  def initialize
    @mcp_client = nil
    @transport = nil
    @anthropic_client = nil
    @tools = []
    @messages = []
  end

  def connect_to_server(server_command)
    @transport = MCP::Client::Stdio.new(command: server_command.first, args: server_command.drop(1))
    @mcp_client = MCP::Client.new(transport: @transport)
    @mcp_client.connect(client_info: { name: "mcp-client-ruby", version: "1.0.0" })

    # The tools are listed once, here; this client doesn't follow later changes.
    @tools = @mcp_client.tools

    # The spec says clients SHOULD validate structured results against the
    # schema the tool declares. This SDK's client does not do it, so compile
    # each declared schema once here and check results as they arrive.
    @output_schemas = @tools.each_with_object({}) do |tool, schemas|
      schemas[tool.name] = MCP::Tool::OutputSchema.new(tool.output_schema) if tool.output_schema
    end

    tool_names = @tools.map(&:name)
    puts "\nConnected to server with tools: #{tool_names}"
  end

  def chat_loop
    puts <<~MESSAGE
      MCP Client Started!
      Type your queries, 'clear' to forget the conversation, or 'quit' to exit.
    MESSAGE

    loop do
      print "\nQuery: "
      $stdout.flush # a pipe is not line-buffered, so show the prompt before waiting
      line = $stdin.gets
      break if line.nil?

      query = line.chomp.strip
      break if query.downcase == "quit"
      next if query.empty?

      if query.downcase == "clear"
        @messages = []
        puts "\nConversation cleared."
        next
      end

      history_length = @messages.length
      begin
        response = process_query(query)
        puts "\n#{response}"
      rescue => e
        # Drop the failed query so a follow-up doesn't send it again.
        @messages.slice!(history_length..)
        puts "\nError: #{e.message}"
      end
    end
  end

  def cleanup
    @transport&.close
  end

  private

  # Translate an MCP tool result into content for an Anthropic tool_result.
  #
  # MCP and Anthropic content blocks differ, so each kind is converted. A kind
  # the model cannot take becomes a placeholder rather than vanishing, so the
  # model knows something was there.
  def tool_result_content(result)
    blocks = Array(result["content"])
    content = blocks.map do |block|
      if block["type"] == "text"
        { type: "text", text: block["text"] }
      elsif block["type"] == "image" && SUPPORTED_IMAGE_TYPES.include?(block["mimeType"])
        { type: "image", source: { type: "base64", media_type: block["mimeType"], data: block["data"] } }
      elsif block["type"] == "resource" && block.dig("resource", "text")
        { type: "text", text: block.dig("resource", "text") }
      else
        { type: "text", text: "[unsupported result type: #{block["type"]}]" }
      end
    end

    content.reject! { |block| block[:text] == "" }
    structured = result["structuredContent"]
    has_text = blocks.any? { |block| block["type"] == "text" && !block["text"].to_s.empty? }
    if !structured.nil? && !has_text
      content << { type: "text", text: structured.to_json }
    end

    content
  end

  def process_query(query)
    history_length = @messages.length
    @messages << { role: "user", content: query }

    available_tools = @tools.map do |tool|
      { name: tool.name, description: tool.description, input_schema: tool.input_schema }
    end

    final_text = []

    (0..MAX_TOOL_TURNS).each do |turn|
      # Tools are passed on every call so Claude can keep calling them.
      response = anthropic_client.messages.create(
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: @messages,
        tools: available_tools
      )

      if response.stop_reason == :refusal
        # Drop the refused query so a follow-up doesn't send it again.
        @messages.slice!(history_length..)
        final_text << "[The model declined to answer; the query is not kept in history]"
        break
      end

      response.content.grep(Anthropic::Models::TextBlock) { |block| final_text << block.text }

      if response.stop_reason == :max_tokens
        final_text << "[Reply cut off at the max_tokens limit]"
        break
      end
      if response.stop_reason != :tool_use
        # The API rejects an empty assistant message, so an empty reply isn't kept.
        @messages << { role: "assistant", content: assistant_content(response) } unless response.content.empty?
        break
      end
      if turn == MAX_TOOL_TURNS
        final_text << "[Stopped after #{MAX_TOOL_TURNS} tool-use turns]"
        break
      end

      # Execute every tool call in this response and collect the results.
      tool_uses = response.content.grep(Anthropic::Models::ToolUseBlock)
      tool_results = tool_uses.map do |tool_use|
        final_text << "[Calling tool #{tool_use.name} with args #{tool_use.input.to_json}]"
        begin
          result = @mcp_client.call_tool(name: tool_use.name, arguments: tool_use.input)
        rescue MCP::Client::ServerError => e
          # A rejected call is the model's mistake to correct, so it goes back as
          # a failed tool_result rather than ending the query. Every tool_use
          # still needs a matching result.
          final_text << "[#{tool_use.name} failed: #{e.message}]"
          next {
            type: "tool_result",
            tool_use_id: tool_use.id,
            content: "Tool call #{tool_use.name} failed: #{e.message}",
            is_error: true
          }
        end

        # structured_content is data the application can use directly; when a
        # tool returns an array, count its items rather than re-reading prose.
        is_error = result.dig("result", "isError") == true
        structured = result.dig("result", "structuredContent")
        unless is_error
          @output_schemas[tool_use.name]&.validate_result(structured)
          final_text << "[#{tool_use.name} returned #{structured.length} items]" if structured.is_a?(Array)
        end

        {
          type: "tool_result",
          tool_use_id: tool_use.id,
          content: tool_result_content(result["result"]),
          is_error: is_error
        }
      end

      # Every tool_use needs a matching tool_result, all in one user message.
      @messages << { role: "assistant", content: assistant_content(response) }
      @messages << { role: "user", content: tool_results }
    end

    final_text.join("\n")
  end

  # Convert a response's content blocks back into request parameters. Thinking
  # blocks must go back unchanged, signature included, or the API rejects the
  # follow-up request.
  def assistant_content(response)
    response.content.filter_map do |block|
      case block
      when Anthropic::Models::TextBlock
        { type: "text", text: block.text }
      when Anthropic::Models::ToolUseBlock
        { type: "tool_use", id: block.id, name: block.name, input: block.input }
      when Anthropic::Models::ThinkingBlock
        { type: "thinking", thinking: block.thinking, signature: block.signature }
      when Anthropic::Models::RedactedThinkingBlock
        { type: "redacted_thinking", data: block.data }
      end
    end
  end

  def anthropic_client
    @anthropic_client ||= Anthropic::Client.new(api_key: ENV["ANTHROPIC_API_KEY"])
  end
end

if ARGV.empty?
  warn "Usage: bundle exec ruby client.rb <server_command> [args...]"
  exit 1
end

client = MCPClient.new

begin
  client.connect_to_server(ARGV)

  api_key = ENV["ANTHROPIC_API_KEY"]
  if api_key.nil? || api_key.empty?
    puts <<~MESSAGE
      No ANTHROPIC_API_KEY found. To query these tools with Claude, set your API key:
        export ANTHROPIC_API_KEY=your-api-key-here
    MESSAGE
    exit
  end

  client.chat_loop
rescue => e
  warn "Error: #{e.message}"
  exit 1
ensure
  client.cleanup
end
