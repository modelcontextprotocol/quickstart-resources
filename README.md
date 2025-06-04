# Quickstart Resources

A repository of servers and clients from the following Model Context Protocol tutorials:
- [Quickstart](https://modelcontextprotocol.io/quickstart) – a simple MCP weather server
- [Building MCP clients](https://modelcontextprotocol.io/tutorials/building-a-client) – an LLM-powered chatbot MCP client

## Extended Features

This repository has been enhanced with additional implementations:

### Integration Methods

| Method                | For Custom GPTs? | For CLI/Dev Use? |
|----------------------|:----------------:|:----------------:|
| `index.ts` (Claude)  |        ❌         |       ✅         |
| `index-openai.ts`    |        ❌         |       ✅         |
| `http-bridge.ts`     |        ✅         |       ✅         |

- **Claude Integration** (`index.ts`): Original CLI client using Anthropic's Claude
- **OpenAI Integration** (`index-openai.ts`): Alternative CLI client using OpenAI GPT models (not for custom GPTs)
- **HTTP API Bridge** (`http-bridge.ts`): REST API server for connecting custom GPTs via Actions (recommended for GPT Builder)

---

### Custom GPT Integration

The HTTP API bridge is the **only supported method** for connecting custom GPTs in OpenAI's GPT Builder:

- REST API server for custom GPT Actions
- File: `http-bridge.ts`
- Web-based integration via OpenAPI schema
- Endpoints: `/weather/forecast`, `/weather/alerts`

#### **How to Connect Your Custom GPT to Your MCP Server**

##### **Step 1: Start Your Servers**

1. **Start the MCP Weather Server**
   ```bash
   cd weather-server-typescript
   npm run build
   node build/index.js
   ```

2. **Start the HTTP Bridge**
   ```bash
   cd mcp-client-typescript
   npm run build-bridge
   node build/http-bridge.js ../weather-server-typescript/build/index.js
   ```

##### **Step 2: Expose Your Local Server to the Internet**

OpenAI requires a public HTTPS endpoint for Actions. The easiest way is to use [ngrok](https://ngrok.com/):

```bash
ngrok http 3000
```
- This will give you a public HTTPS URL like `https://randomstring.ngrok.io`.

##### **Step 3: Prepare Your OpenAPI Schema**

- Download or copy your OpenAPI schema from `http://localhost:3000/openapi.json`.
- Update the `"servers"` section to use your ngrok URL:
  ```json
  "servers": [
    { "url": "https://randomstring.ngrok.io" }
  ]
  ```
- Add a privacy policy and terms of service to the `"info"` section:
  ```json
  "info": {
    "title": "Weather API",
    "description": "Weather forecasts and alerts via MCP",
    "version": "1.0.0",
    "termsOfService": "https://www.example.com/terms",
    "x-privacy-policy-url": "https://www.example.com/privacy"
  }
  ```
- You can use placeholder URLs or your own.

##### **Step 4: Configure Your Custom GPT in GPT Builder**

1. Go to [ChatGPT GPT Builder](https://chat.openai.com/gpts/editor)
2. Click the **Actions** tab.
3. **Import the schema** from your ngrok URL (e.g., `https://randomstring.ngrok.io/openapi.json`) or paste the edited JSON.
4. Set **Authentication** to "None".
5. Save and publish your GPT.

##### **Step 5: Test Your Custom GPT**

Ask your GPT:
- "What's the weather forecast for San Francisco?"
- "Are there any weather alerts in California?"
- "Get me the forecast for latitude 40.7, longitude -74.0"

Your GPT will call your HTTP bridge, which will call your MCP server and return real weather data!

---

#### **Using the HTTP Bridge with Remote or Third-Party MCP Servers**

By default, the HTTP bridge is designed to launch and connect to a local MCP server (e.g., your weather server). However, you can also use it to connect to **any MCP server** that is accessible from your machine, including:

- A remote MCP server running on another machine or in the cloud
- A third-party MCP-compatible service
- A Dockerized MCP server with a mapped port

**How to Connect the HTTP Bridge to a Remote MCP Server:**

1. **Ensure the remote MCP server is running and accessible**  
   - The server must be reachable from the machine running the HTTP bridge (e.g., via public IP, VPN, or SSH tunnel).
   - The server should support the same MCP stdio or TCP transport.

2. **Modify the HTTP bridge launch command**  
   Instead of launching a local script, you can point the bridge to a remote server by:
   - Using an SSH command to start the server remotely and pipe stdio over SSH
   - (Or, for advanced users) Modifying the bridge to use a TCP transport if the MCP server exposes a TCP socket

   **Example: Using SSH to connect to a remote MCP server**
   ```bash
   node build/http-bridge.js "ssh user@remotehost 'node /path/to/remote/build/index.js'"
   ```
   - This will use SSH to start the MCP server on the remote host and connect the stdio streams to your bridge.

3. **(Optional) Use TCP Transport for Direct Network Connections**
   - If your MCP server supports TCP, you can modify the bridge to use `TcpClientTransport` instead of `StdioClientTransport` and provide the remote host/port.

   **Example (pseudo-code):**
   ```js
   import { TcpClientTransport } from '@modelcontextprotocol/sdk/client/tcp.js';
   // ...
   this.transport = new TcpClientTransport({ host: 'remotehost', port: 12345 });
   ```

4. **Continue with the rest of the setup**
   - Expose your HTTP bridge with ngrok or deploy it to a public server as before.
   - Your custom GPT will now be able to access any MCP server you can reach!

**Tip:**  
This flexibility means you can use the HTTP bridge as a universal adapter for any MCP-compatible tool, whether it's running locally, in the cloud, or provided by a third party.

---

#### **Troubleshooting & Tips**

- **Public URL Required:** OpenAI will not accept `localhost` or `http://` URLs for public GPTs. Always use your ngrok HTTPS URL.
- **Privacy Policy:** A valid privacy policy URL is required for public GPTs. Use a placeholder or generate one at [privacypolicies.com](https://www.privacypolicies.com/live/).
- **Schema Import Issues:** If importing from URL fails, copy the JSON and paste it manually.
- **ngrok Free Plan:** The URL changes each time you restart ngrok. Update your schema and GPT config if you restart ngrok.
- **Production:** For a permanent solution, deploy your bridge to a public HTTPS server and use your real domain.

---

### Architecture Overview
```
Custom GPT ──Actions──> HTTP Bridge ──MCP──> Weather Server ──API──> National Weather Service
```

### Quick Demo
1. Start weather server: `cd weather-server-typescript && npm run build && node build/index.js`
2. Start HTTP bridge: `cd mcp-client-typescript && npm run build-bridge && node build/http-bridge.js ../weather-server-typescript/build/index.js`  
3. Create custom GPT with Actions pointing to your ngrok URL (see above)
4. Ask: *"What's the weather in San Francisco?"*

See `mcp-client-typescript/README.md` for detailed setup instructions.
