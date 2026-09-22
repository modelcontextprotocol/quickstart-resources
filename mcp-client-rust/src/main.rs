use anyhow::{Context, Result, bail};
use jsonschema::Validator;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, ClientCapabilities, ClientConfig, Implementation,
    ProtocolVersion, Tool as McpTool,
};
use rmcp::service::{ClientLifecycleMode, ClientServiceExt, RoleClient, RunningService};
use rmcp::transport::TokioChildProcess;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::time::Duration;
use tokio::io::{self, AsyncBufReadExt, BufReader};
use tokio::process::Command;

const MODEL_ANTHROPIC: &str = "claude-sonnet-5";
/// Sonnet 5 thinks adaptively unless told otherwise, and max_tokens caps thinking
/// plus the reply, so leave room for both.
const MAX_TOKENS: u32 = 10000;
const MAX_TOOL_TURNS: usize = 10;

const ANTHROPIC_API_BASE: &str = "https://api.anthropic.com";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// One turn of the conversation, as the Messages API takes it.
///
/// `content` is a list of raw blocks rather than typed ones on purpose. An
/// assistant turn is fed straight back on the next request, and Claude requires
/// the blocks it sent to return unchanged -- a thinking block's `signature`
/// included. Reserialising through a narrower type would drop whatever it does
/// not model.
#[derive(Serialize, Clone)]
struct Message {
    role: &'static str,
    content: Vec<Value>,
}

impl Message {
    fn user(content: Vec<Value>) -> Self {
        Message {
            role: "user",
            content,
        }
    }

    fn assistant(content: Vec<Value>) -> Self {
        Message {
            role: "assistant",
            content,
        }
    }
}

/// A tool as the Messages API declares it, converted from an MCP tool.
#[derive(Serialize, Clone)]
struct ToolDefinition {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    input_schema: Value,
}

#[derive(Serialize)]
struct MessagesRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: &'a [Message],
    tools: &'a [ToolDefinition],
}

#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<Value>,
}

/// The `type` of a content block, when it has one.
fn block_type(block: &Value) -> &str {
    block.get("type").and_then(Value::as_str).unwrap_or_default()
}

struct MCPClient {
    http: reqwest::Client,
    session: Option<RunningService<RoleClient, ClientConfig>>,
    tools: Vec<ToolDefinition>,
    /// Compiled `outputSchema` per tool name. rmcp does not validate results,
    /// so this client does it with the `jsonschema` crate.
    output_schemas: HashMap<String, Validator>,
}

impl MCPClient {
    fn new() -> Result<Self> {
        Ok(MCPClient {
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .context("Failed to build HTTP client")?,
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

        // Without a ClientConfig the client would report rmcp's own crate name
        // and version rather than its own.
        let config = ClientConfig::new(
            ClientCapabilities::default(),
            Implementation::new("mcp-client-rust", "1.0.0"),
        );

        // `Auto` probes server/discover and falls back to the 2025-11-25
        // initialize handshake, matching the Python and TypeScript clients.
        // `serve` alone would only ever do the legacy handshake, under which a
        // server cannot offer this era's features -- an array-rooted
        // `outputSchema`, for one, which get_alerts uses.
        let session = config
            .serve_with_lifecycle(
                process,
                ClientLifecycleMode::Auto {
                    preferred_versions: vec![ProtocolVersion::V_2026_07_28],
                    legacy_version: Some(ProtocolVersion::V_2025_11_25),
                },
            )
            .await?;

        let rmcp_tools = session
            .list_all_tools()
            .await
            .context("Unable to list tools from server")?;

        let tool_names: Vec<String> = rmcp_tools
            .iter()
            .map(|tool| tool.name.to_string())
            .collect();

        let protocol_version = session
            .peer_info()
            .map(|info| info.protocol_version.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        println!("Connected over protocol {protocol_version} with tools: {tool_names:?}");

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

        let mut messages = vec![Message::user(vec![json!({"type": "text", "text": query})])];
        let mut final_text = Vec::new();

        // Initial Claude API call with tools
        let mut content = self.request_model(&messages).await?;

        // Keep calling tools until Claude answers without one, up to a cap.
        for _ in 0..MAX_TOOL_TURNS {
            let mut tool_uses = Vec::new();
            for block in &content {
                match block_type(block) {
                    "text" => {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            final_text.push(text.to_string());
                        }
                    }
                    "tool_use" => tool_uses.push(block.clone()),
                    _ => {}
                }
            }

            if tool_uses.is_empty() {
                return Ok(final_text.join("\n"));
            }

            // Execute every tool call in this response and collect the results
            let mut tool_results = Vec::new();
            for tool_use in &tool_uses {
                let name = tool_use
                    .get("name")
                    .and_then(Value::as_str)
                    .context("tool_use block has no name")?;
                let id = tool_use
                    .get("id")
                    .and_then(Value::as_str)
                    .context("tool_use block has no id")?;
                let input = tool_use.get("input").cloned().unwrap_or(json!({}));

                // Add information about the tool call to final text
                final_text.push(format!("[Calling tool {name} with args {input}]"));

                // Query the MCP server
                let mut params = CallToolRequestParams::new(name.to_string());
                if let Some(arguments) = input.as_object().cloned() {
                    params = params.with_arguments(arguments);
                }
                let tool_result = match session.call_tool(params).await {
                    Ok(result) => result,
                    // A rejected call is the model's mistake to correct, so it
                    // goes back as a failed tool_result rather than ending the
                    // query. Every tool_use still needs a matching result.
                    Err(error) => {
                        final_text.push(format!("[{name} failed: {error}]"));
                        tool_results.push(json!({
                            "type": "tool_result",
                            "tool_use_id": id,
                            "content": format!("Tool call {name} failed: {error}"),
                            "is_error": true,
                        }));
                        continue;
                    }
                };

                self.validate_tool_output(name, &tool_result)?;

                // structured_content is data the application can use directly.
                if let Some(Value::Array(items)) = &tool_result.structured_content {
                    final_text.push(format!("[{name} returned {} items]", items.len()));
                }

                // content is a list of block types; forward only the text ones.
                let mut payload = tool_result
                    .content
                    .iter()
                    .filter_map(|block| block.as_text().map(|text| text.text.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n");

                // A structured result SHOULD also carry serialized JSON in a text
                // block, but only SHOULD, so fall back to serializing it rather
                // than sending the model an empty result.
                if payload.is_empty() {
                    if let Some(structured) = &tool_result.structured_content {
                        payload = structured.to_string();
                    }
                }

                tool_results.push(json!({
                    "type": "tool_result",
                    "tool_use_id": id,
                    "content": payload,
                    "is_error": tool_result.is_error.unwrap_or(false),
                }));
            }

            // Append the assistant's response and all tool results, in one user
            // message, to the history. Every tool_use needs a matching
            // tool_result, and the assistant's blocks go back as they arrived.
            messages.push(Message::assistant(content));
            messages.push(Message::user(tool_results));

            content = self.request_model(&messages).await?;
        }

        // The turn cap was hit. Keep the last response's text. If it asked for
        // more tools, say they were not run.
        let mut wants_tools = false;
        for block in &content {
            match block_type(block) {
                "text" => {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        final_text.push(text.to_string());
                    }
                }
                "tool_use" => wants_tools = true,
                _ => {}
            }
        }
        if wants_tools {
            final_text.push(format!("[Stopped after {MAX_TOOL_TURNS} tool-use turns]"));
        }

        Ok(final_text.join("\n"))
    }

    /// Call Claude with the current history and return the content blocks of
    /// its reply, untouched. Tools are passed on every call so Claude can keep
    /// calling them across turns.
    async fn request_model(&self, messages: &[Message]) -> Result<Vec<Value>> {
        let api_key = std::env::var("ANTHROPIC_API_KEY").context("ANTHROPIC_API_KEY is not set")?;
        // The base URL is configurable for the same reason the official SDKs
        // make it configurable: to point the client at a local stand-in.
        let base_url = std::env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| ANTHROPIC_API_BASE.to_string());

        let request = MessagesRequest {
            model: MODEL_ANTHROPIC,
            max_tokens: MAX_TOKENS,
            messages,
            tools: &self.tools,
        };

        let response = self
            .http
            .post(format!("{}/v1/messages", base_url.trim_end_matches('/')))
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&request)
            .send()
            .await
            .context("Anthropic request failed")?;

        let status = response.status();
        let body = response
            .text()
            .await
            .context("Unable to read the Anthropic response")?;
        if !status.is_success() {
            bail!("Anthropic request failed with {status}: {body}");
        }

        let parsed: MessagesResponse =
            serde_json::from_str(&body).context("Unable to parse the Anthropic response")?;
        Ok(parsed.content)
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
                Err(err) => println!("\nError: {:#}", err),
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

fn convert_tools(tools: &[McpTool]) -> Vec<ToolDefinition> {
    tools
        .iter()
        .map(|tool| ToolDefinition {
            name: tool.name.to_string(),
            description: tool.description.as_deref().map(str::to_string),
            input_schema: Value::Object(tool.input_schema.as_ref().clone()),
        })
        .collect()
}
