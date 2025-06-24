import asyncio
from typing import Optional
from contextlib import AsyncExitStack
import requests  # Add import for requests library
import json  # Add import for json handling

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()  # load environment variables from .env

class MCPClient:
    def __init__(self):
        # Initialize session and client objects
        self.session: Optional[ClientSession] = None
        self.exit_stack = AsyncExitStack()
        self.anthropic = Anthropic()
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer n4MoOsTPlmquMT0sxxyrAfbp@3025",
        }

    async def connect_to_server(self, server_script_path: str):
        """Connect to an MCP server
        
        Args:
            server_script_path: Path to the server script (.py or .js)
        """
        is_python = server_script_path.endswith('.py')
        is_js = server_script_path.endswith('.js')
        if not (is_python or is_js):
            raise ValueError("Server script must be a .py or .js file")
            
        command = "python" if is_python else "node"
        server_params = StdioServerParameters(
            command=command,
            args=[server_script_path],
            env=None
        )
        
        stdio_transport = await self.exit_stack.enter_async_context(stdio_client(server_params))
        self.stdio, self.write = stdio_transport
        self.session = await self.exit_stack.enter_async_context(ClientSession(self.stdio, self.write))
        
        await self.session.initialize()
        
        # List available tools
        response = await self.session.list_tools()
        tools = response.tools
        print("\nConnected to server with tools:", [tool.name for tool in tools])

    async def process_query(self, query: str) -> str:
        """Process a query using LLM API and available tools"""
        messages = [
            {
                "role": "user",
                "content": query
            }
        ]

        # Get available tools from the MCP session
        response = await self.session.list_tools()
        mcp_tools = response.tools
        
        # Convert MCP tools to OpenAI format
        openai_tools = []
        for tool in mcp_tools:
            # Process inputSchema - it might be already a dict or a JSON string
            if isinstance(tool.inputSchema, str):
                parameters = json.loads(tool.inputSchema)
            else:
                parameters = tool.inputSchema
                
            # Convert each MCP tool to OpenAI tool format
            openai_tool = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": parameters
                }
            }
            openai_tools.append(openai_tool)

        # Initial LLM API call
        url = "http://v2.open.venus.oa.com/llmproxy/chat/completions"
        model = "qwen3-235b-a22b-fp8-local-II"

        # API call parameters with OpenAI format tools
        data = {
            "model": model,
            "messages": messages,
            "tools": openai_tools  # Use the converted OpenAI format tools
        }
        
        try:
            llm_response = requests.post(url, headers=self.headers, json=data)
            llm_response.raise_for_status()
            response_data = llm_response.json()
            
            # Process response and handle tool calls
            final_text = []
            
            # Extract the response content
            assistant_message = response_data['choices'][0]['message']
            assistant_content = assistant_message.get('content', '')
            
            if assistant_content:
                final_text.append(assistant_content)
            
            # Handle tool calls if present
            tool_calls = assistant_message.get('tool_calls', [])
            
            if tool_calls:
                for tool_call in tool_calls:
                    tool_name = tool_call['function']['name']
                    tool_args = json.loads(tool_call['function']['arguments'])
                    
                    # Execute tool call using MCP
                    result = await self.session.call_tool(tool_name, tool_args)
                    
                    # Convert TextContent object to string if needed
                    tool_result_content = str(result.content) if hasattr(result, 'content') else str(result)
                    
                    final_text.append(f"[Tool {tool_name} result: {tool_result_content[:200]}...]")
                    
                    # Continue conversation with tool results
                    messages.append({
                        "role": "assistant",
                        "content": assistant_content,
                        "tool_calls": [tool_call]
                    })
                    
                    messages.append({
                        "role": "tool", 
                        "tool_call_id": tool_call['id'],
                        "name": tool_name,
                        "content": tool_result_content
                    })
                    
                    # Get next response from LLM API
                    llm_response = requests.post(
                        url,
                        headers=self.headers,
                        json={
                            "model": model,
                            "messages": messages,
                            "tools": openai_tools
                        }
                    )
                    llm_response.raise_for_status()
                    next_response_data = llm_response.json()
                    
                    next_content = next_response_data['choices'][0]['message'].get('content', '')
                    if next_content:
                        final_text.append(next_content)

                return "\n".join(final_text)
            else:
                # No tool calls, just return the content
                return assistant_content
        
        except Exception as e:
            print(f"Error calling LLM API: {str(e)}")
            if 'llm_response' in locals() and hasattr(llm_response, 'text'):
                print(f"Response text: {llm_response.text}")
            
            # Try to provide a useful error response
            if 'response_data' in locals() and assistant_content:
                return f"Error processing tool calls, but I can tell you that: {assistant_content}"
            return f"Error when calling LLM API: {str(e)}"

    async def chat_loop(self):
        """Run an interactive chat loop"""
        print("\nMCP Client Started!")
        print("Type your queries or 'quit' to exit.")
        
        while True:
            try:
                query = input("\nQuery: ").strip()
                
                if query.lower() == 'quit':
                    break
                    
                response = await self.process_query(query)
                print("\n" + response)
                    
            except Exception as e:
                print(f"\nError: {str(e)}")
    
    async def cleanup(self):
        """Clean up resources"""
        await self.exit_stack.aclose()

async def main():
    if len(sys.argv) < 2:
        print("Usage: python client.py <path_to_server_script>")
        sys.exit(1)
        
    client = MCPClient()
    try:
        await client.connect_to_server(sys.argv[1])
        await client.chat_loop()
    finally:
        await client.cleanup()

if __name__ == "__main__":
    import sys
    asyncio.run(main())
