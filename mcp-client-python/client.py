import asyncio
import json
import os
import sys
import threading
from contextlib import AsyncExitStack

from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from mcp import Client, MCPError, StdioServerParameters
from mcp_types import CallToolResult, EmbeddedResource, ImageContent, Implementation, TextContent, TextResourceContents

load_dotenv()  # load environment variables from .env

ANTHROPIC_MODEL = "claude-sonnet-5"
# Sonnet 5 thinks adaptively unless told otherwise, and max_tokens caps thinking
# plus the reply, so leave room for both.
MAX_TOKENS = 10000
MAX_TOOL_TURNS = 10
SYSTEM_PROMPT = "You are a helpful assistant. Use the available tools when they help answer the question."
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
        self._anthropic: AsyncAnthropic | None = None
        self.tools: list[dict] = []
        self.messages: list[dict] = []

    @property
    def anthropic(self) -> AsyncAnthropic:
        """Lazy-initialize Anthropic client when needed"""
        if self._anthropic is None:
            self._anthropic = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        return self._anthropic

    async def connect_to_server(self, server_command: list[str]):
        """Connect to an MCP server

        Args:
            server_command: The command that starts the server, and its arguments
        """
        server_params = StdioServerParameters(command=server_command[0], args=server_command[1:])

        # Client launches the command itself when given StdioServerParameters.
        # "auto", the SDK's default, probes server/discover, falling back to the
        # 2025-11-25 handshake.
        self.client = await self.exit_stack.enter_async_context(
            Client(
                server_params,
                mode="auto",
                client_info=Implementation(name="mcp-client-python", version="1.0.0"),
            )
        )

        # The tools are listed once, here; this client doesn't follow later changes.
        response = await self.client.list_tools()
        self.tools = [
            {"name": tool.name, "description": tool.description, "input_schema": tool.input_schema}
            for tool in response.tools
        ]
        print(
            f"\nConnected over protocol {self.client.protocol_version} with tools:",
            [tool.name for tool in response.tools],
        )

    async def process_query(self, query: str) -> str:
        """Process a query using Claude and available tools"""
        history_length = len(self.messages)
        self.messages.append({"role": "user", "content": query})

        final_text = []

        for turn in range(MAX_TOOL_TURNS + 1):
            response = await self.anthropic.messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=self.messages,
                tools=self.tools,
            )

            if response.stop_reason == "refusal":
                # Drop the refused query so a follow-up doesn't send it again.
                del self.messages[history_length:]
                final_text.append("[The model declined to answer; the query is not kept in history]")
                break

            final_text.extend(content.text for content in response.content if content.type == "text")

            if response.stop_reason == "max_tokens":
                final_text.append("[Reply cut off at the max_tokens limit]")
                break
            if response.stop_reason != "tool_use":
                # The API rejects an empty assistant message, so an empty reply isn't kept.
                if response.content:
                    self.messages.append({"role": "assistant", "content": response.content})
                break
            if turn == MAX_TOOL_TURNS:
                final_text.append(f"[Stopped after {MAX_TOOL_TURNS} tool-use turns]")
                break

            tool_results = []
            for tool_use in (content for content in response.content if content.type == "tool_use"):
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

            self.messages.append({"role": "assistant", "content": response.content})
            self.messages.append({"role": "user", "content": tool_results})

        return "\n".join(final_text)

    async def chat_loop(self):
        """Run an interactive chat loop"""
        print("\nMCP Client Started!")
        print("Type your queries, 'clear' to forget the conversation, or 'quit' to exit.")

        while True:
            try:
                query = (await read_line("\nQuery: ")).strip()
            except EOFError:
                break

            if query.lower() == "quit":
                break
            if not query:
                continue
            if query.lower() == "clear":
                self.messages.clear()
                print("\nConversation cleared.")
                continue

            history_length = len(self.messages)
            try:
                response = await self.process_query(query)
                print("\n" + response)
            except Exception as e:
                # Drop the failed query so a follow-up doesn't send it again.
                del self.messages[history_length:]
                print(f"\nError: {str(e)}")

    async def cleanup(self):
        """Clean up resources"""
        await self.exit_stack.aclose()


async def read_line(prompt: str) -> str:
    """input() without blocking the event loop.

    It runs on a daemon thread, so Ctrl-C at the prompt doesn't have to wait
    for a line that never comes, as it would with asyncio.to_thread.
    """
    loop = asyncio.get_running_loop()
    line = loop.create_future()

    def finish(result, error):
        if line.done():
            return  # Ctrl-C cancelled the read
        if error:
            line.set_exception(error)
        else:
            line.set_result(result)

    def read():
        result, error = None, None
        try:
            # The raw stream takes no lock, so exiting mid-read is safe.
            data = sys.stdin.buffer.raw.readline()
            if not data:
                raise EOFError
            result = data.decode(sys.stdin.encoding, sys.stdin.errors)
        except Exception as e:
            error = e
        try:
            loop.call_soon_threadsafe(finish, result, error)
        except RuntimeError:
            pass  # the loop has closed: the client is exiting

    print(prompt, end="", flush=True)

    threading.Thread(target=read, daemon=True).start()
    return await line


async def main():
    if len(sys.argv) < 2:
        print("Usage: uv run client.py <server_command> [args...]", file=sys.stderr)
        sys.exit(1)

    client = MCPClient()
    try:
        await client.connect_to_server(sys.argv[1:])

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
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print()  # Ctrl-C quits like `quit`; cleanup has already run.
