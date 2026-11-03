import asyncio
import json
import os
from contextlib import AsyncExitStack
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv
from mcp import Client, MCPError, StdioServerParameters
from mcp_types import CallToolResult, EmbeddedResource, ImageContent, TextContent, TextResourceContents

load_dotenv()  # load environment variables from .env

ANTHROPIC_MODEL = "claude-sonnet-5"
# Sonnet 5 thinks adaptively unless told otherwise, and max_tokens caps thinking
# plus the reply, so leave room for both.
MAX_TOKENS = 10000
MAX_TOOL_TURNS = 10
# Image types the Messages API accepts.
SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def tool_result_content(result: CallToolResult) -> list[dict]:
    """Translate an MCP tool result into content for an Anthropic tool_result.

    MCP and Anthropic content blocks differ, so each kind is converted. A kind
    the model cannot take becomes a placeholder rather than vanishing, so the
    model knows something was there.
    """
    content: list[dict] = []
    for block in result.content:
        if isinstance(block, TextContent):
            content.append({"type": "text", "text": block.text})
        elif isinstance(block, ImageContent) and block.mime_type in SUPPORTED_IMAGE_TYPES:
            content.append(
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": block.mime_type, "data": block.data},
                }
            )
        elif isinstance(block, EmbeddedResource) and isinstance(block.resource, TextResourceContents):
            content.append({"type": "text", "text": block.resource.text})
        else:
            content.append({"type": "text", "text": f"[unsupported result type: {block.type}]"})

    content = [block for block in content if block.get("text") != ""]
    has_text = any(isinstance(block, TextContent) and block.text for block in result.content)
    if result.structured_content is not None and not has_text:
        content.append({"type": "text", "text": json.dumps(result.structured_content)})

    return content


class MCPClient:
    def __init__(self):
        # Initialize session and client objects
        self.client: Client | None = None
        self.exit_stack = AsyncExitStack()
        self._anthropic: Anthropic | None = None

    @property
    def anthropic(self) -> Anthropic:
        """Lazy-initialize Anthropic client when needed"""
        if self._anthropic is None:
            self._anthropic = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        return self._anthropic

    async def connect_to_server(self, server_script_path: str):
        """Connect to an MCP server

        Args:
            server_script_path: Path to the server script (.py or .js)
        """
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

        # Client launches the command itself when given StdioServerParameters.
        # "auto" probes server/discover, falling back to the 2025-11-25 handshake.
        self.client = await self.exit_stack.enter_async_context(Client(server_params, mode="auto"))

        # List available tools
        response = await self.client.list_tools()
        tools = response.tools
        print(f"\nConnected over protocol {self.client.protocol_version} with tools:", [tool.name for tool in tools])

    async def process_query(self, query: str) -> str:
        """Process a query using Claude and available tools"""
        messages = [{"role": "user", "content": query}]

        tools_response = await self.client.list_tools()
        available_tools = [
            {"name": tool.name, "description": tool.description, "input_schema": tool.input_schema}
            for tool in tools_response.tools
        ]

        final_text = []

        response = self.anthropic.messages.create(
            model=ANTHROPIC_MODEL, max_tokens=MAX_TOKENS, messages=messages, tools=available_tools
        )

        for _ in range(MAX_TOOL_TURNS):
            tool_uses = []
            for content in response.content:
                if content.type == "text":
                    final_text.append(content.text)
                elif content.type == "tool_use":
                    tool_uses.append(content)

            if not tool_uses:
                return "\n".join(final_text)

            tool_results = []
            for tool_use in tool_uses:
                final_text.append(f"[Calling tool {tool_use.name} with args {tool_use.input}]")
                try:
                    # call_tool validates the result against the declared schema.
                    result = await self.client.call_tool(tool_use.name, tool_use.input)
                except MCPError as error:
                    # A rejected call is the model's mistake to correct, so it goes
                    # back as a failed tool_result rather than ending the query.
                    # Every tool_use still needs a matching result.
                    final_text.append(f"[{tool_use.name} failed: {error}]")
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "content": f"Tool call {tool_use.name} failed: {error}",
                            "is_error": True,
                        }
                    )
                    continue

                # structured_content is data the application can use directly.
                if isinstance(result.structured_content, list):
                    final_text.append(f"[{tool_use.name} returned {len(result.structured_content)} items]")

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": tool_result_content(result),
                        "is_error": bool(result.is_error),
                    }
                )

            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})

            response = self.anthropic.messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=MAX_TOKENS,
                messages=messages,
                tools=available_tools,
            )

        # The turn cap was hit. Keep the last response's text. If it asked for
        # more tools, say they were not run.
        final_text.extend(content.text for content in response.content if content.type == "text")
        if any(content.type == "tool_use" for content in response.content):
            final_text.append(f"[Stopped after {MAX_TOOL_TURNS} tool-use turns]")
        return "\n".join(final_text)

    async def chat_loop(self):
        """Run an interactive chat loop"""
        print("\nMCP Client Started!")
        print("Type your queries or 'quit' to exit.")

        while True:
            # input() blocks, so keep it off the event loop.
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
        """Clean up resources"""
        await self.exit_stack.aclose()


async def main():
    if len(sys.argv) < 2:
        print("Usage: python client.py <path_to_server_script>")
        sys.exit(1)

    client = MCPClient()
    try:
        await client.connect_to_server(sys.argv[1])

        # Check if we have a valid API key to continue
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            print("\nNo ANTHROPIC_API_KEY found. To query these tools with Claude, set your API key:")
            print("  export ANTHROPIC_API_KEY=your-api-key-here")
            return

        await client.chat_loop()
    finally:
        await client.cleanup()


if __name__ == "__main__":
    import sys

    asyncio.run(main())
