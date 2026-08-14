import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

// Helper function for making NWS API requests
async function makeNWSRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/geo+json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making NWS request:", error);
    return null;
  }
}

interface AlertFeature {
  properties: {
    event?: string;
    areaDesc?: string;
    severity?: string;
    description?: string;
    instruction?: string;
  };
}

interface ForecastPeriod {
  name?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  detailedForecast?: string;
}

interface AlertsResponse {
  features: AlertFeature[];
}

interface PointsResponse {
  properties: {
    forecast?: string;
  };
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[];
  };
}

/**
 * The output schema of `get-alerts`: a top-level array, not an object, which
 * revision 2026-07-28 is the first to allow. The SDK projects it down to the
 * old `{ result: [...] }` wrapper for 2025-11-25 clients.
 */
const alertsOutputSchema = z.array(
  z.object({
    event: z.string().describe("The kind of weather event"),
    area: z.string().describe("The area the alert covers"),
    severity: z.string().describe("How severe the event is"),
    description: z.string().describe("What is happening"),
    instructions: z.string().describe("What people in the area should do"),
  }),
);

/** The output schema of `get-forecast`: the object case. */
const forecastOutputSchema = z.object({
  latitude: z.number().describe("Latitude the forecast is for"),
  longitude: z.number().describe("Longitude the forecast is for"),
  periods: z
    .array(
      z.object({
        name: z.string(),
        temperature: z.number().nullable(),
        temperature_unit: z.string(),
        wind_speed: z.string(),
        wind_direction: z.string(),
        detailed_forecast: z.string(),
      }),
    )
    .describe("The forecast periods, soonest first"),
});

type Alert = z.infer<typeof alertsOutputSchema>[number];
type Forecast = z.infer<typeof forecastOutputSchema>;

// Format alert data for the model to read
function formatAlert(alert: Alert): string {
  return [
    `Event: ${alert.event}`,
    `Area: ${alert.area}`,
    `Severity: ${alert.severity}`,
    `Description: ${alert.description}`,
    `Instructions: ${alert.instructions}`,
    "---",
  ].join("\n");
}

function formatPeriod(period: Forecast["periods"][number]): string {
  return [
    `${period.name}:`,
    period.temperature === null
      ? "Temperature: Unknown"
      : `Temperature: ${period.temperature}°${period.temperature_unit}`,
    `Wind: ${period.wind_speed} ${period.wind_direction}`,
    period.detailed_forecast,
    "---",
  ].join("\n");
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "weather",
    version: "1.0.0",
  });

  server.registerTool(
    "get-alerts",
    {
      title: "Get Weather Alerts",
      description: "Get weather alerts for a state",
      inputSchema: z.object({
        state: z
          .string()
          .length(2)
          .describe("Two-letter state code (e.g. CA, NY)"),
      }),
      outputSchema: alertsOutputSchema,
    },
    async ({ state }) => {
      const stateCode = state.toUpperCase();
      const alertsUrl = `${NWS_API_BASE}/alerts/active/area/${stateCode}`;
      const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

      if (!alertsData) {
        throw new Error(`Failed to retrieve alerts data for ${stateCode}`);
      }

      // An empty result is an empty array, not an error.
      // `??` catches the nulls NWS sends for these fields; it does not omit
      // them, so a key-missing default would not fire.
      const alerts: Alert[] = (alertsData.features ?? []).map((feature) => ({
        event: feature.properties.event ?? "Unknown",
        area: feature.properties.areaDesc ?? "Unknown",
        severity: feature.properties.severity ?? "Unknown",
        description: feature.properties.description ?? "No description available",
        instructions:
          feature.properties.instruction ?? "No specific instructions provided",
      }));

      const text =
        alerts.length === 0
          ? `No active alerts for ${stateCode}`
          : `Active alerts for ${stateCode}:\n\n${alerts.map(formatAlert).join("\n")}`;

      return { content: [{ type: "text", text }], structuredContent: alerts };
    },
  );

  server.registerTool(
    "get-forecast",
    {
      title: "Get Weather Forecast",
      description: "Get weather forecast for a location",
      inputSchema: z.object({
        latitude: z
          .number()
          .min(-90)
          .max(90)
          .describe("Latitude of the location"),
        longitude: z
          .number()
          .min(-180)
          .max(180)
          .describe("Longitude of the location"),
      }),
      outputSchema: forecastOutputSchema,
    },
    async ({ latitude, longitude }) => {
      // Get grid point data
      const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
      const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

      if (!pointsData) {
        throw new Error(
          `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
        );
      }

      const forecastUrl = pointsData.properties?.forecast;
      if (!forecastUrl) {
        throw new Error("Failed to get forecast URL from grid point data");
      }

      // Get forecast data
      const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
      if (!forecastData) {
        throw new Error("Failed to retrieve forecast data");
      }

      const rawPeriods = forecastData.properties?.periods ?? [];
      if (rawPeriods.length === 0) {
        throw new Error("No forecast periods available");
      }

      const forecast: Forecast = {
        latitude,
        longitude,
        // Only show the next 5 periods.
        periods: rawPeriods.slice(0, 5).map((period) => ({
          name: period.name ?? "Unknown",
          temperature: period.temperature ?? null,
          temperature_unit: period.temperatureUnit ?? "F",
          wind_speed: period.windSpeed ?? "Unknown",
          wind_direction: period.windDirection ?? "Unknown",
          detailed_forecast: period.detailedForecast ?? "No forecast available",
        })),
      };

      const text = `Forecast for ${latitude}, ${longitude}:\n\n${forecast.periods
        .map(formatPeriod)
        .join("\n")}`;

      return { content: [{ type: "text", text }], structuredContent: forecast };
    },
  );

  return server;
}

// One factory serves both protocol eras.
serveStdio(buildServer, {
  onerror: (error) => {
    console.error("Weather MCP Server error:", error);
  },
});
console.error("Weather MCP Server running on stdio");
