use anyhow::{Context, Result, bail};
use genai::Client;
use genai::chat::{
    ChatMessage, ChatOptions, ChatRequest, ChatResponse, ContentPart, Tool as GenaiTool,
    ToolResponse,
};
use jsonschema::Validator;
use rmcp::model::{CallToolRequestParams, CallToolResult, Tool as McpTool};
use rmcp::service::{RoleClient, RunningService, ServiceExt};
use rmcp::transport::TokioChildProcess;
use serde_json::Value;
use std::collections::HashMap;
use tokio::io::{self, AsyncBufReadExt, BufReader};
use tokio::process::Command;

const MODEL_ANTHROPIC: &str = "claude-sonnet-5";
/// Sonnet 5 thinks adaptively unless told otherwise, and max_tokens caps thinking
/// plus the reply, so leave room for both.
const MAX_TOKENS: u32 = 10000;
const MAX_TOOL_TURNS: usize = 10;

struct MCPClient {
    anthropic: Client,
    session: Option<RunningService<RoleClient, ()>>,
    tools: Vec<GenaiTool>,
    /// Compiled `outputSchema` per tool name. rmcp does not validate results,
    /// so this client does it with the `jsonschema` crate.
    output_schemas: HashMap<String, Validator>,
}

impl MCPClient {
    fn new() -> Result<Self> {
        Ok(MCPClient {
            anthropic: Client::default(),
            session: None,
            tools: Vec::new(),
            output_schemas: HashMap::new(),
        })
    }

    /// Check a result against its tool's declared `outputSchema`. Error results
    /// are exempt: they carry a message, not data.
    fn validate_tool_output(&self, name: &str, result: &CallToolResult) -> Result<()> {
        let Some(validator) = self.output_schemas.get(name) else {
            return Ok(());
        };
        if result.is_error.unwrap_or(false) {
            return Ok(());
        }
        let Some(structured) = &result.structured_content else {
            bail!("Tool {name} declares an output schema but returned no structured content");
        };
        if let Err(error) = validator.validate(structured) {
            bail!("Structured content from tool {name} does not match its output schema: {error}");
        }
        Ok(())
    }

    async fn connect_to_server(&mut self, server_args: &[String]) -> Result<()> {
        if self.session.is_some() {
            bail!("Client is already connected to a server");
        }

        let mut command = Command::new(&server_args[0]);
        command.args(&server_args[1..]);

        let process = TokioChildProcess::new(command)
            .with_context(|| format!("Failed to spawn server process for {:?}", server_args))?;

        let session = ().serve(process).await?;

        let rmcp_tools = session
            .list_all_tools()
            .await
            .context("Unable to list tools from server")?;

        let tool_names: Vec<String> = rmcp_tools
            .iter()
            .map(|tool| tool.name.to_string())
            .collect();

        println!("Connected to server with tools: {tool_names:?}");

        // An outputSchema root may be any JSON Schema, not just an object.
        for tool in &rmcp_tools {
            let Some(schema) = &tool.output_schema else {
                continue;
            };
            let schema = Value::Object(schema.as_ref().clone());
            let validator = Validator::new(&schema).with_context(|| {
                format!("Failed to compile output schema of tool {}", tool.name)
            })?;
            self.output_schemas.insert(tool.name.to_string(), validator);
        }

        self.tools = convert_tools(&rmcp_tools);
        self.session = Some(session);
        Ok(())
    }

    async fn process_query(&mut self, query: &str) -> Result<String> {
        let session = self
            .session
            .as_ref()
            .context("Client is not connected to any server")?;

        let mut messages = vec![ChatMessage::user(query)];
        let mut final_text = Vec::new();

        // Initial Claude API call with tools
        let mut chat_rsp = self.request_model(&messages).await?;

        // Keep calling tools until Claude answers without one, up to a cap.
        for _ in 0..MAX_TOOL_TURNS {
            for text in chat_rsp.texts() {
                final_text.push(text.to_string());
            }

            let tool_calls = chat_rsp.tool_calls();
            if tool_calls.is_empty() {
                return Ok(final_text.join("\n"));
            }

            // Execute every tool call in this response and collect the results
            let mut tool_results = Vec::new();
            for tool_call in tool_calls {
                // Add information about the tool call to final text
                let tool_args_str = serde_json::to_string(&tool_call.fn_arguments)
                    .unwrap_or_else(|_| "{}".to_string());

                final_text.push(format!(
                    "[Calling tool {} with args {}]",
                    tool_call.fn_name, tool_args_str
                ));

                // Query the MCP server
                let mut params = CallToolRequestParams::new(tool_call.fn_name.clone());
                if let Some(arguments) = tool_call.fn_arguments.as_object().cloned() {
                    params = params.with_arguments(arguments);
                }
                let tool_result = session
                    .call_tool(params)
                    .await
                    .with_context(|| format!("Tool call {} failed", tool_call.fn_name))?;

                self.validate_tool_output(&tool_call.fn_name, &tool_result)?;

                // structured_content is data the application can use directly.
                if let Some(Value::Array(items)) = &tool_result.structured_content {
                    final_text.push(format!(
                        "[{} returned {} items]",
                        tool_call.fn_name,
                        items.len()
                    ));
                }

                // content is a list of block types; forward only the text ones.
                let mut payload = tool_result
                    .content
                    .iter()
                    .filter_map(|block| block.as_text().map(|text| text.text.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n");

                // genai's ToolResponse cannot set Anthropic's `is_error` flag, so
                // an error result is marked in the text instead.
                if tool_result.is_error.unwrap_or(false) {
                    payload = format!("Error: {payload}");
                }

                tool_results.push(ContentPart::ToolResponse(ToolResponse::new(
                    tool_call.call_id.clone(),
                    payload,
                )));
            }

            // Append the assistant's response and all tool results, in one user
            // message, to the history. Every tool call needs a matching result.
            messages.push(ChatMessage::assistant(chat_rsp.content.clone()));
            messages.push(ChatMessage::user(tool_results));

            chat_rsp = self.request_model(&messages).await?;
        }

        // The turn cap was hit. Keep the text of the last response; drop its tool calls.
        for text in chat_rsp.texts() {
            final_text.push(text.to_string());
        }
        final_text.push(format!("[Stopped after {MAX_TOOL_TURNS} tool-use turns]"));

        Ok(final_text.join("\n"))
    }

    /// Call Claude with the current history. Tools are passed on every call so
    /// Claude can keep calling them across turns.
    async fn request_model(&self, messages: &[ChatMessage]) -> Result<ChatResponse> {
        let chat_req = ChatRequest::new(messages.to_vec()).with_tools(self.tools.clone());
        let options = ChatOptions::default().with_max_tokens(MAX_TOKENS);

        let response = self
            .anthropic
            .exec_chat(MODEL_ANTHROPIC, chat_req, Some(&options))
            .await
            .context("Anthropic chat request failed")?;

        Ok(response)
    }

    async fn chat_loop(&mut self) -> Result<()> {
        println!("\nMCP Client Started!");
        println!("Type your queries or 'quit' to exit.");

        let mut stdin = BufReader::new(io::stdin());
        let mut input = String::new();

        loop {
            print!("\nQuery: ");
            std::io::Write::flush(&mut std::io::stdout())?;

            input.clear();
            if stdin.read_line(&mut input).await? == 0 {
                break; // EOF
            }

            let query = input.trim();
            if query.eq_ignore_ascii_case("quit") {
                break;
            }
            if query.is_empty() {
                continue;
            }

            match self.process_query(query).await {
                Ok(response) => println!("\n{}", response),
                Err(err) => println!("\nError: {}", err),
            }
        }

        Ok(())
    }

    async fn cleanup(&mut self) -> Result<()> {
        if let Some(session) = self.session.take() {
            let _ = session.cancel().await;
        }
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // .env is optional; the key may come from the environment instead.
    let _ = dotenvy::dotenv();

    let mut args = std::env::args();
    let _ = args.next();
    let server_args: Vec<String> = args.collect();

    if server_args.is_empty() {
        eprintln!("Usage: cargo run -- <server_script_or_binary> [args...]");
        std::process::exit(1);
    }

    let mut client = MCPClient::new()?;

    let result = async {
        client.connect_to_server(&server_args).await?;

        // Connecting and listing tools needs no credentials; querying them
        // does. Matching the Python and TypeScript clients, report and exit
        // rather than failing, so the connection itself can be exercised
        // without a key.
        // Empty counts as unset, as it does in the other clients: `KEY= cmd`
        // is how the smoke test forces this path.
        if std::env::var("ANTHROPIC_API_KEY").map_or(true, |key| key.is_empty()) {
            println!("\nNo ANTHROPIC_API_KEY found. To query these tools with Claude, set your API key:");
            println!("  export ANTHROPIC_API_KEY=your-api-key-here");
            return Ok(());
        }

        client.chat_loop().await
    }
    .await;

    let cleanup_result = client.cleanup().await;

    result?;
    cleanup_result?;

    Ok(())
}

fn convert_tools(tools: &[McpTool]) -> Vec<GenaiTool> {
    tools
        .iter()
        .map(|tool| GenaiTool {
            name: tool.name.to_string(),
            description: tool.description.as_deref().map(str::to_string),
            schema: Some(Value::Object(tool.input_schema.as_ref().clone())),
            config: None,
        })
        .collect()
}
