# An LLM-Powered Chatbot MCP Client written in TypeScript

See the [Building MCP clients](https://modelcontextprotocol.io/tutorials/building-a-client) tutorial for more information.

# Testing with MCP-Server-Kubernetes

```
npm install
npm run build
```

Local:
```
node build/index.js ../../mcp-server-kubernetes/dist/index.js
```

Docker:
```
node build/index.js "docker run -v /Users/suyogsonwalkar/.kube:/home/appuser/.kube -i flux159/mcp-server-kubernetes"
```
