import express from 'express';
import cors from 'cors';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

class MCPHttpBridge {
  private app = express();
  private mcp: Client;
  private transport: StdioClientTransport | null = null;
  private availableTools: any[] = [];

  constructor() {
    this.mcp = new Client({ name: 'mcp-http-bridge', version: '1.0.0' });
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    // Enable CORS for all routes (needed for custom GPT Actions)
    this.app.use(
      cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      })
    );

    // Parse JSON bodies
    this.app.use(express.json());

    // Logging middleware
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        connectedToMCP: this.transport !== null,
        availableTools: this.availableTools.map((t) => t.name),
      });
    });

    // OpenAPI schema endpoint for custom GPT Actions
    this.app.get('/.well-known/ai-plugin.json', (req, res) => {
      res.json({
        schema_version: 'v1',
        name_for_human: 'Weather API',
        name_for_model: 'weather_api',
        description_for_human:
          'Get weather forecasts and alerts from the National Weather Service',
        description_for_model:
          'Weather API that provides forecasts and alerts for US locations using the National Weather Service API',
        auth: {
          type: 'none',
        },
        api: {
          type: 'openapi',
          url: `http://localhost:${PORT}/openapi.json`,
        },
      });
    });

    // OpenAPI specification
    this.app.get('/openapi.json', (req, res) => {
      res.json({
        openapi: '3.0.1',
        info: {
          title: 'Weather API',
          description: 'Weather forecasts and alerts via MCP',
          version: '1.0.0',
        },
        servers: [
          {
            url: `http://localhost:${PORT}`,
          },
        ],
        paths: {
          '/weather/forecast': {
            get: {
              operationId: 'getWeatherForecast',
              summary: 'Get weather forecast for coordinates',
              parameters: [
                {
                  name: 'latitude',
                  in: 'query',
                  required: true,
                  schema: { type: 'number', minimum: -90, maximum: 90 },
                  description: 'Latitude of the location',
                },
                {
                  name: 'longitude',
                  in: 'query',
                  required: true,
                  schema: { type: 'number', minimum: -180, maximum: 180 },
                  description: 'Longitude of the location',
                },
              ],
              responses: {
                '200': {
                  description: 'Weather forecast',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          success: { type: 'boolean' },
                          data: { type: 'string' },
                          timestamp: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '/weather/alerts': {
            get: {
              operationId: 'getWeatherAlerts',
              summary: 'Get weather alerts for a US state',
              parameters: [
                {
                  name: 'state',
                  in: 'query',
                  required: true,
                  schema: { type: 'string', pattern: '^[A-Z]{2}$' },
                  description: 'Two-letter US state code (e.g. CA, NY)',
                },
              ],
              responses: {
                '200': {
                  description: 'Weather alerts',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          success: { type: 'boolean' },
                          data: { type: 'string' },
                          timestamp: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
    });

    // Weather forecast endpoint
    // @ts-ignore
    this.app.get('/weather/forecast', async (req, res) => {
      try {
        const { latitude, longitude } = req.query;

        if (!latitude || !longitude) {
          return res.status(400).json({
            success: false,
            error: 'Missing required parameters: latitude and longitude',
          });
        }

        const lat = parseFloat(latitude as string);
        const lng = parseFloat(longitude as string);

        if (
          isNaN(lat) ||
          isNaN(lng) ||
          lat < -90 ||
          lat > 90 ||
          lng < -180 ||
          lng > 180
        ) {
          return res.status(400).json({
            success: false,
            error: 'Invalid latitude or longitude values',
          });
        }

        const result = await this.mcp.callTool({
          name: 'get-forecast',
          arguments: { latitude: lat, longitude: lng },
        });

        const forecastText = Array.isArray(result.content)
          ? result.content
              .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
              .join('\n')
          : typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content);

        res.json({
          success: true,
          data: forecastText,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Error getting forecast:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to get weather forecast',
        });
      }
    });

    // Weather alerts endpoint
    // @ts-ignore
    this.app.get('/weather/alerts', async (req, res) => {
      try {
        const { state } = req.query;

        if (!state) {
          return res.status(400).json({
            success: false,
            error: 'Missing required parameter: state',
          });
        }

        const stateCode = (state as string).toUpperCase();
        if (!/^[A-Z]{2}$/.test(stateCode)) {
          return res.status(400).json({
            success: false,
            error: 'State must be a two-letter code (e.g. CA, NY)',
          });
        }

        const result = await this.mcp.callTool({
          name: 'get-alerts',
          arguments: { state: stateCode },
        });

        const alertsText = Array.isArray(result.content)
          ? result.content
              .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
              .join('\n')
          : typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content);

        res.json({
          success: true,
          data: alertsText,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Error getting alerts:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to get weather alerts',
        });
      }
    });

    // Catch-all for undefined routes
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        availableEndpoints: [
          'GET /health',
          'GET /weather/forecast?latitude=X&longitude=Y',
          'GET /weather/alerts?state=XX',
          'GET /openapi.json',
        ],
      });
    });
  }

  async connectToMCPServer(serverScriptPath: string) {
    try {
      console.log(`Connecting to MCP server: ${serverScriptPath}`);

      const isJs = serverScriptPath.endsWith('.js');
      const isPy = serverScriptPath.endsWith('.py');
      if (!isJs && !isPy) {
        throw new Error('Server script must be a .js or .py file');
      }

      const command = isPy
        ? process.platform === 'win32'
          ? 'python'
          : 'python3'
        : process.execPath;

      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });

      this.mcp.connect(this.transport);

      // Get available tools
      const toolsResult = await this.mcp.listTools();
      this.availableTools = toolsResult.tools;

      console.log(
        'Connected to MCP server with tools:',
        this.availableTools.map((t) => t.name)
      );
    } catch (error) {
      console.error('Failed to connect to MCP server:', error);
      throw error;
    }
  }

  start() {
    this.app.listen(PORT, () => {
      console.log(`🚀 MCP HTTP Bridge running on http://localhost:${PORT}`);
      console.log(
        `📋 API documentation: http://localhost:${PORT}/openapi.json`
      );
      console.log(`🔍 Health check: http://localhost:${PORT}/health`);
      console.log('\n📡 Available endpoints:');
      console.log(`   GET  /weather/forecast?latitude=X&longitude=Y`);
      console.log(`   GET  /weather/alerts?state=XX`);
    });
  }

  async cleanup() {
    if (this.transport) {
      await this.mcp.close();
    }
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: node build/http-bridge.js <path_to_mcp_server_script>');
    process.exit(1);
  }

  const bridge = new MCPHttpBridge();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down HTTP bridge...');
    await bridge.cleanup();
    process.exit(0);
  });

  try {
    await bridge.connectToMCPServer(process.argv[2]);
    bridge.start();
  } catch (error) {
    console.error('Failed to start HTTP bridge:', error);
    process.exit(1);
  }
}

main();
