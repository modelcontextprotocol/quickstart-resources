# frozen_string_literal: true

require "anthropic"
require "dotenv/load"
require "json"
require "mcp"

class MCPClient
  ANTHROPIC_MODEL = "claude-sonnet-4-5"

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

    # Initial Claude API call.
    response = chat(messages, tools: available_tools)

    # Process response and handle tool calls.
    if response.content.any?(Anthropic::Models::ToolUseBlock)
      assistant_content = response.content.filter_map do |content_block|
        case content_block
        when Anthropic::Models::TextBlock
          { type: "text", text: content_block.text }
        when Anthropic::Models::ToolUseBlock
          { type: "tool_use", id: content_block.id, name: content_block.name, input: content_block.input }
        end
      end
      messages << { role: "assistant", content: assistant_content }
    end

    response.content.each_with_object([]) do |content, response_parts|
      case content
      when Anthropic::Models::TextBlock
        response_parts << content.text
      when Anthropic::Models::ToolUseBlock
        # Execute tool call via MCP.
        result = @mcp_client.call_tool(name: content.name, arguments: content.input)
        response_parts << "[Calling tool #{content.name} with args #{content.input.to_json}]"

        tool_result_content = result.dig("result", "content")
        result_text = if tool_result_content.is_a?(Array)
          tool_result_content.filter_map { |content_item| content_item["text"] }.join("\n")
        else
          tool_result_content.to_s
        end

        messages << {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: content.id,
            content: result_text
          }]
        }

        # Get next response from Claude.
        response = chat(messages)

        response.content.each do |content_block|
          response_parts << content_block.text if content_block.is_a?(Anthropic::Models::TextBlock)
        end
      end
    end.join("\n")
  end

  def chat(messages, tools: nil)
    params = { model: ANTHROPIC_MODEL, max_tokens: 1000, messages: messages }
    params[:tools] = tools if tools

    anthropic_client.messages.create(**params)
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
