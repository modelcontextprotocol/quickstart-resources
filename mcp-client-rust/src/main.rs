use anyhow::{Context, Result, bail};
use genai::Client;
use genai::chat::{
    ChatMessage, ChatRequest, ChatResponse, ContentPart, Tool as GenaiTool, ToolResponse,
};
use rmcp::model::{CallToolRequestParam, Tool as McpTool};
use rmcp::service::{RoleClient, RunningService, ServiceExt};
use rmcp::transport::TokioChildProcess;
use serde_json::Value;
use tokio::io::{self, AsyncBufReadExt, BufReader};
use tokio::process::Command;

const MODEL_ANTHROPIC: &str = "claude-sonnet-4-20250514";

struct MCPClient {
    anthropic: Client,
    session: Option<RunningService<RoleClient, ()>>,
    tools: Vec<GenaiTool>,
}

impl MCPClient {
    fn new() -> Result<Self> {
        Ok(MCPClient {
            anthropic: Client::default(),
            session: None,
            tools: Vec::new(),
        })
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
        let mut chat_req = ChatRequest::new(messages.clone()).with_tools(self.tools.clone());
        let mut chat_rsp = self.request_model(&chat_req).await?;

        // Process response content - collect text and handle tool calls
        for text in chat_rsp.texts() {
            final_text.push(text.to_string());
        }

        let tool_calls = chat_rsp.tool_calls();
        if !tool_calls.is_empty() {
            // Append assistant's response to message history
            messages.push(ChatMessage::assistant(chat_rsp.content.clone()));

            // Execute each tool call and collect responses
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
                let tool_result = session
                    .call_tool(CallToolRequestParam {
                        name: tool_call.fn_name.clone().into(),
                        arguments: tool_call.fn_arguments.as_object().cloned(),
                    })
                    .await
                    .with_context(|| format!("Tool call {} failed", tool_call.fn_name))?;

                let payload = serde_json::to_string(&tool_result)
                    .context("Failed to serialize tool result")?;

                tool_results.push(ContentPart::ToolResponse(ToolResponse::new(
                    tool_call.call_id.clone(),
                    payload,
                )));
            }

            // Append tool responses to message history
            messages.push(ChatMessage::user(tool_results));

            // Build the next request and query model
            chat_req = ChatRequest::new(messages.clone());
            chat_rsp = self.request_model(&chat_req).await?;

            // Collect text from response
            for text in chat_rsp.texts() {
                final_text.push(text.to_string());
            }
        }

        Ok(final_text.join("\n"))
    }

    async fn request_model(&self, chat_req: &ChatRequest) -> Result<ChatResponse> {
        let response = self
            .anthropic
            .exec_chat(MODEL_ANTHROPIC, chat_req.clone(), None)
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
    dotenvy::dotenv().context("Failed to load env file")?;

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
