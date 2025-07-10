# MCP
[MCP Docs](https://context7.com/context7/modelcontextprotocol_io-introduction/llms.txt?tokens=79801)

## Gemini MCP Client

1. Isolate anthropic specific calls and logic.  
1.1 Read anthropic docs for response schema

### Tools

#### Function Definitions
How are decorated tools in the mcp-server formatted?

#### Tool Use Response Schema
[Antropic tool docs](https://docs.anthropic.com/en/api/messages#body-tools)

The model produces the following kind of `content_block` when it needs to use a tool:

```json
[
  {
    "type": "tool_use",
    "id": "toolu_01D7FLrfh4GYq7yT1ULFeyMV",
    "name": "get_stock_price",
    "input": { "ticker": "^GSPC" }
  }
]
```

Where:  
    - `name`: tool/function name
    - `input`: a dictionary of arguments to tool, with parameter, value as key, value pairs.

This is why `input` is passed directly to the mcp client's `call_tool` method; it is already in dictionary form.

[Gemini Function Calling]()

A tool use response is parsed as follows:

```python
tool_call = response.candidates[0].content.parts[0].function_call

# schedule_meeting is an example of a tool
# defined as a python function
if tool_call.name == "schedule_meeting":
    result = schedule_meeting(**tool_call.args)
    print(f"Function execution result: {result}")
```

`tool_call.args` contains the arguments and is formatted as follows (an example):

```
{'topic': 'Q3 planning', 'attendees': ['Bob', 'Alice'], 'date': '2025-03-14', 'time': '10:00'}
```

It's json-like at least (I'm not sure whether single quotes disqualify it).

#### Actions

Here we describe how to accomplish the same flow that is implemented for anthropic in `client.py`.

1. We import the necessary google client tools
```python
# Configure the client and tools
client = genai.Client(api_key=api_key) # to be loaded with .env
tools = types.Tool(function_declarations=[schedule_meeting_function])
config = types.GenerateContentConfig(tools=[tools])

```
2. We make the first call to the model:
```python
# Define user prompt
contents = [
    types.Content(
        role="user", parts=[types.Part(text="Schedule a meeting with Bob and Alice for 03/14/2025 at 10:00 AM about the Q3 planning.")]
    )
]

# Send request with function declarations
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=contents,
    config=config,
)
```

1. We replace anthropic's `content.input`, with gemini's `tool_call.args`.

**Note:**  
We are warned that there may be more than one `part` in gemini's response schema. In our example we only take the first part (`part[0]`), but perhaps we could loop through them to ensure we dont miss the tool call.

2. We execute the tool by passing the tool name and arguments to `result = await self.session.call_tool`.

3. We pass the results of execution AND prior messages as context to the model to get a final response.

```python
# Create a function response part
function_response_part = types.Part.from_function_response(
    name=tool_call.name,
    response={"result": result},
)

# Append function call and result of the function execution to contents
contents.append(response.candidates[0].content) # Append the content from the model's response.
contents.append(types.Content(role="user", parts=[function_response_part])) # Append the function response

final_response = client.models.generate_content(
    model="gemini-2.5-flash",
    config=config,
    contents=contents,
)

print(final_response.text)
```

### Clarifications
#### Tool Declaration

This is a json schema that describes the function to the model. For multiple tools these declarations will be a `list[dict]'. Gemini expects it to be formatted as below (our example):

```python
 # Define the function declaration for the model
schedule_meeting_function = {
    "name": "schedule_meeting",
    "description": "Schedules a meeting with specified attendees at a given time and date.",
    "parameters": {
        "type": "object",
        "properties": {
            "attendees": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of people attending the meeting.",
            },
            "date": {
                "type": "string",
                "description": "Date of the meeting (e.g., '2024-07-29')",
            },
            "time": {
                "type": "string",
                "description": "Time of the meeting (e.g., '15:00')",
            },
            "topic": {
                "type": "string",
                "description": "The subject or topic of the meeting.",
            },
        },
        "required": ["attendees", "date", "time", "topic"],
    },
}
```

or as follows (another example)

```python
# Define a function that the model can call to control smart lights
set_light_values_declaration = {
    "name": "set_light_values",
    "description": "Sets the brightness and color temperature of a light.",
    "parameters": {
        "type": "object",
        "properties": {
            "brightness": {
                "type": "integer",
                "description": "Light level from 0 to 100. Zero is off and 100 is full brightness",
            },
            "color_temp": {
                "type": "string",
                "enum": ["daylight", "cool", "warm"],
                "description": "Color temperature of the light fixture, which can be `daylight`, `cool` or `warm`.",
            },
        },
        "required": ["brightness", "color_temp"],
    },
}

```


Usually we would have to write this out by hand for each function. However, within an MCP context, this schema is generated automatically from functions defined in an mcp-server. They are made available to us thusly:

```python
response = await self.session.list_tools()
available_tools = [{ 
    "name": tool.name,
    "description": tool.description,
    "input_schema": tool.inputSchema
} for tool in response.tools]
```

the keys of the resulting tool schemas may need to be adapted to Gemini. eg. `input_schema` to `paramters`

**NOTE**. The argument schema may need to be verified.

#### Multiple Tool Calls
For now we simply intend to support one tool call per response.

**NOTE**: Research multi-part responses in gemini docs

#### Error handling
The documentation says the following about this (only a snippet, not exhaustive):

> Clients SHOULD return standard JSON-RPC errors for common failure cases:

    Client does not support roots: -32601 (Method not found)
    Internal errors: -32603

Example error:
Copy

{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32601,
    "message": "Roots not supported",
    "data": {
      "reason": "Client does not have roots capability"
    }
  }
}

#### Session and state management

Calls to LLMs are inherently stateless. We maintain the illusion of state by appending past messages to the current message before we send it to the LLM.

If with reference to the `session` object you simply use it as already outlined (more documentation will be provided)

```python
self.session = await self.exit_stack.enter_async_context(ClientSession(self.stdio, self.write))

```

#### Async vs sync

They can be synchronous just like the original anthropic code (unless it is not in which case you can differ).

#### API key management

I have already provided the api key in a .env file at the project root. This is standard enough for now

#### Testing

We have no tests for now but we SHOULD create them for the code we are attempting to write. In fact, we can follow a TDD approach in which we write the tests first then the code. Pytest should be sufficient.