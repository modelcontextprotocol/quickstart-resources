# An LLM-Powered Chatbot MCP Client written in TypeScript

This project includes multiple implementations for connecting MCP servers to different AI models and custom GPTs.

## Features

- **Claude Integration** (`index.ts`) - Original implementation using Anthropic's Claude
- **OpenAI Integration** (`index-openai.ts`) - Alternative implementation using OpenAI GPT models  
- **HTTP API Bridge** (`http-bridge.ts`) - REST API server for connecting custom GPTs via Actions

## Quick Start

### Prerequisites

```bash
npm install
```

### Method 1: Direct AI Model Integration

#### Using Claude (Original)
```bash
# Set up environment
echo "ANTHROPIC_API_KEY=your_key_here" > .env

# Build and run
npm run build
node build/index.js path/to/mcp-server-script
```

#### Using OpenAI GPT
```bash
# Set up environment  
echo "OPENAI_API_KEY=your_key_here" > .env

# Build and run
npm run build-openai  
node build/index-openai.js path/to/mcp-server-script
```

### Method 2: Custom GPT Integration via HTTP Bridge

#### Step 1: Start the HTTP Bridge
```bash
# Build the bridge
npm run build-bridge

# Start the bridge (connects to your MCP server)
node build/http-bridge.js path/to/mcp-server-script
```

This starts a REST API server on `http://localhost:3000` with endpoints:
- `GET /weather/forecast?latitude=X&longitude=Y` - Get weather forecast
- `GET /weather/alerts?state=XX` - Get weather alerts  
- `GET /health` - Health check
- `GET /openapi.json` - OpenAPI specification

#### Step 2: Connect Custom GPT

**Option A: Import Schema (Recommended)**
1. Go to [ChatGPT GPT Builder](https://chat.openai.com/gpts/editor)
2. Click **Actions** tab
3. **Import from URL**: `http://localhost:3000/openapi.json`
4. **Authentication**: None

**Option B: Manual Schema**
1. Go to GPT Builder → Actions
2. Paste the OpenAPI schema from `/openapi.json` endpoint
3. Set **Authentication** to None

#### Step 3: Test Your Custom GPT
Your custom GPT can now answer queries like:
- "What's the weather forecast for San Francisco?"
- "Are there any weather alerts in California?"
- "Get me the forecast for latitude 40.7, longitude -74.0"

## Architecture

```
Custom GPT ──HTTP──> HTTP Bridge ──MCP──> Weather Server ──API──> National Weather Service
     ↑           ↑         ↑          ↑           ↑                        ↑
  Actions    REST API  localhost:3000   MCP    Your Server            Real Data
```

## Build Scripts

- `npm run build` - Build Claude client
- `npm run build-openai` - Build OpenAI client  
- `npm run build-bridge` - Build HTTP bridge
- `npm run build-all` - Build all implementations

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for Claude integration
- `OPENAI_API_KEY` - Required for OpenAI integration
- `PORT` - HTTP bridge port (default: 3000)

## Tutorial

See the [Building MCP clients](https://modelcontextprotocol.io/tutorials/building-a-client) tutorial for more information about the original Claude implementation.
