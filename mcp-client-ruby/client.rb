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

  def initialize
    @mcp_client = nil
    @transport = nil
    @anthropic_client = nil
  end

  def connect_to_server(server_script_path)
    command = case File.extname(server_script_path)
    when ".rb"
      "ruby"
    when ".py"
      "python3"
    when ".js"
      "node"
    else
      raise ArgumentError, "Server script must be a .rb, .py, or .js file."
    end

    @transport = MCP::Client::Stdio.new(command: command, args: [server_script_path])
    @mcp_client = MCP::Client.new(transport: @transport)
    @mcp_client.connect

    # The spec says clients SHOULD validate structured results against the
    # schema the tool declares. This SDK's client does not do it, so compile
    # each declared schema once here and check results as they arrive.
    @output_schemas = @mcp_client.tools.each_with_object({}) do |tool, schemas|
      schemas[tool.name] = MCP::Tool::OutputSchema.new(tool.output_schema) if tool.output_schema
    end

    tool_names = @mcp_client.tools.map(&:name)
    puts "\nConnected to server with tools: #{tool_names}"
  end

  def chat_loop
    puts <<~MESSAGE
      MCP Client Started!
      Type your queries or 'quit' to exit.
    MESSAGE

    loop do
      print "\nQuery: "
      $stdout.flush # a pipe is not line-buffered, so show the prompt before waiting
      line = $stdin.gets
      break if line.nil?

      query = line.chomp.strip
      break if query.downcase == "quit"
      next if query.empty?

      begin
        response = process_query(query)
        puts "\n#{response}"
      rescue => e
        puts "\nError: #{e.message}"
      end
    end
  end

  def cleanup
    @transport&.close
  end

  private

  def process_query(query)
    messages = [{ role: "user", content: query }]

    available_tools = @mcp_client.tools.map do |tool|
      { name: tool.name, description: tool.description, input_schema: tool.input_schema }
    end

    final_text = []

    # Initial Claude API call with tools.
    response = chat(messages, available_tools)

    # Keep calling tools until Claude answers without one, up to a cap.
    MAX_TOOL_TURNS.times do
      tool_uses = []
      response.content.each do |block|
        case block
        when Anthropic::Models::TextBlock
          final_text << block.text
        when Anthropic::Models::ToolUseBlock
          tool_uses << block
        end
      end

      return final_text.join("\n") if tool_uses.empty?

      # Execute every tool call in this response and collect the results.
      tool_results = tool_uses.map do |tool_use|
        result = @mcp_client.call_tool(name: tool_use.name, arguments: tool_use.input)
        final_text << "[Calling tool #{tool_use.name} with args #{tool_use.input.to_json}]"

        # structured_content is data the application can use directly; when a
        # tool returns an array, count its items rather than re-reading prose.
        is_error = result.dig("result", "isError") == true
        structured = result.dig("result", "structuredContent")
        unless is_error
          @output_schemas[tool_use.name]&.validate_result(structured)
          final_text << "[#{tool_use.name} returned #{structured.length} items]" if structured.is_a?(Array)
        end

        # content is a list of block types; forward only the text ones.
        tool_result_content = result.dig("result", "content")
        result_text = if tool_result_content.is_a?(Array)
          tool_result_content.filter_map { |content_item| content_item["text"] }.join("\n")
        else
          tool_result_content.to_s
        end

        { type: "tool_result", tool_use_id: tool_use.id, content: result_text, is_error: is_error }
      end

      # Append the assistant's response and all tool results, in one user
      # message, to the history. Every tool_use needs a matching tool_result.
      messages << { role: "assistant", content: assistant_content(response) }
      messages << { role: "user", content: tool_results }

      response = chat(messages, available_tools)
    end

    # The turn cap was hit. Keep the last response's text. If it asked for
    # more tools, say they were not run.
    response.content.each do |block|
      final_text << block.text if block.is_a?(Anthropic::Models::TextBlock)
    end
    if response.content.any?(Anthropic::Models::ToolUseBlock)
      final_text << "[Stopped after #{MAX_TOOL_TURNS} tool-use turns]"
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

  # Tools are passed on every call so Claude can keep calling them across turns.
  def chat(messages, tools)
    anthropic_client.messages.create(
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      messages: messages,
      tools: tools
    )
  end

  def anthropic_client
    @anthropic_client ||= Anthropic::Client.new(api_key: ENV["ANTHROPIC_API_KEY"])
  end
end

if ARGV.empty?
  puts "Usage: ruby client.rb <path_to_server_script>"
  exit 1
end

client = MCPClient.new

begin
  client.connect_to_server(ARGV[0])

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
  puts "Error: #{e.message}"
  exit 1
ensure
  client.cleanup
end
