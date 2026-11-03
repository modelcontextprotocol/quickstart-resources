/**
 * Values the mock MCP server returns and the tool-loop test looks for in what
 * the client forwards to the model. They live here rather than in
 * mock-mcp-server.ts, because importing that file would start the server.
 */

export const STRUCTURED_ONLY_VALUE = "structured-only-value";
export const RESOURCE_TEXT = "resource-text-value";
/** A 1x1 transparent PNG. */
export const IMAGE_DATA =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
