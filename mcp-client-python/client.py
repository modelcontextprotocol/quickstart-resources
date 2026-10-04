import asyncio
import os
import sys
from contextlib import AsyncExitStack
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from mcp import Client, StdioServerParameters
from mcp_types import TextContent

load_dotenv()  # load environment variables from .env

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
MAX_TOOL_TURNS = 10


class MCPClient:
    def __init__(self):
        self.client: Client | None = None
        self.exit_stack = AsyncExitStack()
        self._gemini: genai.Client | None = None

    @property
    def gemini(self) -> genai.Client:
        """Lazy-initialize the Gemini client when needed."""
        if self._gemini is None:
            api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY is not set.")
            self._gemini = genai.Client(api_key=api_key)
        return self._gemini

    @staticmethod
    def _tool_declarations(tools: list[object]) -> list[types.Tool]:
        declared_tools: list[types.Tool] = []
        for tool in tools:
            input_schema = getattr(tool, "input_schema", None) or {}
            declared_tools.append(
                types.Tool(
                    function_declarations=[
                        types.FunctionDeclaration(
                            name=getattr(tool, "name", ""),
                            description=getattr(tool, "description", "") or "",
                            parameters=input_schema,
                        )
                    ]
                )
            )
        return declared_tools

    @staticmethod
    def _extract_text(response: object) -> str:
        if hasattr(response, "text") and response.text:
            return response.text

        text_parts: list[str] = []
        for candidate in getattr(response, "candidates", []) or []:
            content = getattr(candidate, "content", None)
            if not content:
                continue
            for part in getattr(content, "parts", []) or []:
                if getattr(part, "text", None):
                    text_parts.append(part.text)

        return "\n".join(text_parts)

    async def connect_to_server(self, server_script_path: str):
        """Connect to an MCP server."""
        is_python = server_script_path.endswith(".py")
        is_js = server_script_path.endswith(".js")
        if not (is_python or is_js):
            raise ValueError("Server script must be a .py or .js file")

        if is_python:
            path = Path(server_script_path).resolve()
            server_params = StdioServerParameters(
                command="uv",
                args=["--directory", str(path.parent), "run", path.name],
                env=None,
            )
        else:
            server_params = StdioServerParameters(command="node", args=[server_script_path], env=None)

        self.client = await self.exit_stack.enter_async_context(Client(server_params, mode="auto"))

        response = await self.client.list_tools()
        tools = response.tools
        print(f"\nConnected over protocol {self.client.protocol_version} with tools:", [tool.name for tool in tools])

    async def process_query(self, query: str) -> str:
        """Process a query using Gemini and any available MCP tools."""
        tools_response = await self.client.list_tools()
        gemini_tools = self._tool_declarations(tools_response.tools)
        contents: list[dict[str, object]] = [{"role": "user", "parts": [{"text": query}]}]

        response = self.gemini.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config={"tools": gemini_tools},
        )

        for _ in range(MAX_TOOL_TURNS):
            function_calls = getattr(response, "function_calls", None) or []
            if not function_calls:
                return self._extract_text(response)

            signature_parts: list[dict[str, object]] = []
            for candidate in getattr(response, "candidates", []) or []:
                for part in getattr(getattr(candidate, "content", None), "parts", []) or []:
                    function_call = getattr(part, "function_call", None)
                    if function_call is None:
                        continue
                    signature_parts.append(
                        {
                            "function_call": {"name": function_call.name, "args": function_call.args or {}},
                            "thought_signature": getattr(part, "thought_signature", None),
                        }
                    )

            for function_call in function_calls:
                result = await self.client.call_tool(function_call.name, function_call.args or {})

                tool_text = "\n".join(
                    block.text for block in result.content if isinstance(block, TextContent) and getattr(block, "text", None)
                )
                if not tool_text and result.structured_content is not None:
                    tool_text = str(result.structured_content)

                if signature_parts:
                    contents.append({"role": "model", "parts": signature_parts})
                else:
                    contents.append(
                        {
                            "role": "model",
                            "parts": [{"function_call": {"name": function_call.name, "args": function_call.args or {}}}],
                        }
                    )
                contents.append(
                    {
                        "role": "user",
                        "parts": [{"function_response": {"name": function_call.name, "response": {"output": tool_text}}}],
                    }
                )

            response = self.gemini.models.generate_content(
                model=GEMINI_MODEL,
                contents=contents,
                config={"tools": gemini_tools},
            )

        return self._extract_text(response)

    async def chat_loop(self):
        """Run an interactive chat loop."""
        print("\nMCP Client Started!")
        print("Type your queries or 'quit' to exit.")

        while True:
            try:
                query = (await asyncio.to_thread(input, "\nQuery: ")).strip()
            except (EOFError, KeyboardInterrupt):
                break

            if query.lower() == "quit":
                break

            try:
                response = await self.process_query(query)
                print("\n" + response)
            except Exception as e:
                print(f"\nError: {str(e)}")

    async def cleanup(self):
        """Clean up resources."""
        await self.exit_stack.aclose()


async def main():
    if len(sys.argv) < 2:
        print("Usage: python client.py <path_to_server_script>")
        sys.exit(1)

    client = MCPClient()
    try:
        await client.connect_to_server(sys.argv[1])

        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            print("\nNo GEMINI_API_KEY found. To query these tools with Gemini, set your API key:")
            print("  export GEMINI_API_KEY=your-api-key-here")
            return

        await client.chat_loop()
    finally:
        await client.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
