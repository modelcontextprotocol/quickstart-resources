import * as dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// --- CONFIGURAZIONE OPENWEATHERMAP ---
// ⚠️ SOSTITUISCI QUESTO CON LA TUA VERA CHIAVE API DI OPENWEATHERMAP
const API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENWEATHER_API_BASE = "https://api.openweathermap.org/data/2.5";
// Lingua italiana e unità metriche (Celsius)
const QUERY_PARAMS = `appid=${API_KEY}&units=metric&lang=it`;

// --- FUNZIONE DI UTILITY PER LE RICHIESTE ---
/**
 * Helper function for making OpenWeatherMap API requests
 */
async function makeOpenWeatherRequest<T>(endpoint: string): Promise<T | null> {
  const url = `${OPENWEATHER_API_BASE}/${endpoint}&${QUERY_PARAMS}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Includi il messaggio di errore se disponibile
      const errorData = await response.json();
      throw new Error(
        `HTTP error! status: ${response.status}. Message: ${
          errorData.message || "Unknown error"
        }`
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making OpenWeatherMap request:", error);
    return null;
  }
}

// --- INTERFACCE DATI OPENWEATHERMAP (Simplified) ---

// Struttura per un elemento della previsione (es. temperatura, descrizione)
interface WeatherMain {
  temp: number;
  feels_like: number;
  temp_min: number;
  temp_max: number;
  pressure: number;
  humidity: number;
}

// Struttura per la descrizione del tempo
interface WeatherDescription {
  main: string; // Es. "Clouds"
  description: string; // Es. "nuvole sparse"
  icon: string;
}

// Struttura per il vento
interface Wind {
  speed: number;
  deg: number; // Gradi
}

// Risposta dell'API "current weather" (meteo attuale)
interface CurrentWeatherResponse {
  coord: {
    lat: number;
    lon: number;
  };
  weather: WeatherDescription[];
  main: WeatherMain;
  wind: Wind;
  name: string; // Nome della città
}

// --- FUNZIONE DI FORMATTAZIONE ---
function formatWeather(data: CurrentWeatherResponse): string {
  const weather = data.weather[0]; // Prende la prima e principale descrizione
  const main = data.main;
  const wind = data.wind;

  return [
    `Meteo attuale per: **${data.name || "Sconosciuto"}**`,
    "---",
    `🌡️ Temperatura: ${main.temp.toFixed(
      1
    )}°C (Percepita: ${main.feels_like.toFixed(1)}°C)`,
    `Min/Max: ${main.temp_min.toFixed(1)}°C / ${main.temp_max.toFixed(1)}°C`,
    `☀️ Condizioni: ${
      weather.description.charAt(0).toUpperCase() + weather.description.slice(1)
    }`,
    `💨 Vento: ${wind.speed.toFixed(1)} m/s (${wind.deg}°)`,
    `💧 Umidità: ${main.humidity}%`,
    `Pressione: ${main.pressure} hPa`,
  ].join("\n");
}

// --- SERVER MCP ---
const server = new McpServer({
  name: "weather",
  version: "1.0.0",
});

// Ho rimosso il tool get-alerts in quanto non supportato per codice stato da OpenWeatherMap.

server.registerTool(
  "get-forecast",
  {
    description:
      "Ottieni la previsione meteo attuale per una posizione in Italia o Europa (e nel mondo)",
    inputSchema: {
      latitude: z
        .number()
        .min(-90)
        .max(90)
        .describe("Latitudine della posizione"),
      longitude: z
        .number()
        .min(-180)
        .max(180)
        .describe("Longitudine della posizione"),
    },
  },
  async ({ latitude, longitude }) => {
    // Usa l'endpoint 'weather' per ottenere i dati attuali
    const endpoint = `weather?lat=${latitude.toFixed(
      4
    )}&lon=${longitude.toFixed(4)}`;
    const weatherData = await makeOpenWeatherRequest<CurrentWeatherResponse>(
      endpoint
    );

    if (!weatherData) {
      return {
        content: [
          {
            type: "text",
            text: "Impossibile recuperare i dati meteo. Verifica le coordinate o la chiave API.",
          },
        ],
      };
    }

    const forecastText = formatWeather(weatherData);

    return {
      content: [
        {
          type: "text",
          text: forecastText,
        },
      ],
    };
  }
);

// Start the server
async function main() {
  // Verifica se la chiave API è stata aggiornata
  // if (API_KEY === "YOUR_OPENWEATHER_API_KEY_HERE") {
  //   console.error(
  //     "FATAL ERROR: Per favore, sostituisci 'YOUR_OPENWEATHER_API_KEY_HERE' nel codice con la tua chiave API di OpenWeatherMap."
  //   );
  //   process.exit(1);
  // }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather MCP Server running on stdio (using OpenWeatherMap)");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
