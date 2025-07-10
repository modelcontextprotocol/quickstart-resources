import os
from typing import Optional
from contextlib import AsyncExitStack
from dotenv import load_dotenv

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Use the new google-genai SDK
from google import genai
from google.genai import types

load_dotenv()  # Load environment variables from .env

class MCPClientGemini:
    def __init__(self):
        self.session: Optional[ClientSession] = None
        self.exit_stack = AsyncExitStack()
        # GEMINI_API_KEY or GOOGLE_API_KEY is picked up automatically
        self.client = genai.Client()
        # Default model, can be parameterized
        self.model = 'gemini-2.5-flash'

    async def connect_to_server(self, server_script_path: str):
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
        response = await self.session.list_tools()
        tools = response.tools
        print("\nConnected to server with tools:", [tool.name for tool in tools])

    def _tools_for_gemini(self, tools):
        # Convert MCP tool schema to Gemini-compatible function declarations
        gemini_tools = []
        for tool in tools:
            function = types.FunctionDeclaration(
                name=tool.name,
                description=tool.description,
                parameters=tool.inputSchema
            )
            gemini_tools.append(types.Tool(function_declarations=[function]))
        return gemini_tools

    async def process_query(self, query: str) -> str:
        response = await self.session.list_tools()
        gemini_tools = self._tools_for_gemini(response.tools)
        # Prepare chat history (can be extended for multi-turn)
        contents = types.Content(
            role='user',
            parts=[types.Part.from_text(text=query)]
        )
        config = types.GenerateContentConfig(
            tools=gemini_tools
        )
        # Use async client for async call
        result = await self.client.aio.models.generate_content(
            model=self.model,
            contents=[contents],
            config=config
        )
        final_text = []
        # Handle function calls if present
        if hasattr(result, 'function_calls') and result.function_calls:
            for call in result.function_calls:
                tool_name = call.name
                tool_args = call.function_call.args
                try:
                    tool_result = await self.session.call_tool(tool_name, tool_args)
                    final_text.append(f"[Called tool {tool_name} with args {tool_args}]")
                    # Send tool result back to Gemini as a function response
                    function_response_part = types.Part.from_function_response(
                        name=tool_name,
                        response=tool_result.content
                    )
                    function_response_content = types.Content(
                        role='tool', parts=[function_response_part]
                    )
                    # Continue the conversation with the function response
                    result2 = await self.client.aio.models.generate_content(
                        model=self.model,
                        contents=[contents, call, function_response_content],
                        config=types.GenerateContentConfig(tools=gemini_tools)
                    )
                    final_text.append(result2.text)
                except Exception as e:
                    final_text.append(f"[Error calling tool {tool_name}: {e}]")
        else:
            final_text.append(result.text)
        return "\n".join(final_text)

    async def chat_loop(self):
        print("\nMCP Gemini Client Started!")
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
        await self.exit_stack.aclose()

async def main():
    import sys
    if len(sys.argv) < 2:
        print("Usage: python client_gemini.py <path_to_server_script>")
        sys.exit(1)
    client = MCPClientGemini()
    try:
        await client.connect_to_server(sys.argv[1])
        await client.chat_loop()
    finally:
        await client.cleanup()

if __name__ == "__main__":
    import sys
    import asyncio
    asyncio.run(main())
