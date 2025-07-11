from typing import Any
import httpx
from mcp.server.fastmcp import FastMCP
import os
from dotenv import load_dotenv

# Load .env from project root (parent directory)
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
load_dotenv(env_path)

# Initialize FastMCP server
mcp = FastMCP("weather")

# Constants
NWS_API_BASE = "https://api.weather.gov"
USER_AGENT = "weather-app/1.0"

async def make_nws_request(url: str) -> dict[str, Any] | None:
    """Make a request to the NWS API with proper error handling."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/geo+json"
    }
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, headers=headers, timeout=30.0)
            response.raise_for_status()
            return response.json()
        except Exception:
            return None

def format_alert(feature: dict) -> str:
    """Format an alert feature into a readable string."""
    props = feature["properties"]
    return f"""
Event: {props.get('event', 'Unknown')}
Area: {props.get('areaDesc', 'Unknown')}
Severity: {props.get('severity', 'Unknown')}
Description: {props.get('description', 'No description available')}
Instructions: {props.get('instruction', 'No specific instructions provided')}
"""

@mcp.tool()
async def get_alerts(state: str) -> str:
    """Get weather alerts for a US state.

    Args:
        state: Two-letter US state code (e.g. CA, NY)
    """
    url = f"{NWS_API_BASE}/alerts/active/area/{state}"
    data = await make_nws_request(url)

    if not data or "features" not in data:
        return "Unable to fetch alerts or no alerts found."

    if not data["features"]:
        return "No active alerts for this state."

    alerts = [format_alert(feature) for feature in data["features"]]
    return "\n---\n".join(alerts)

@mcp.tool()
async def get_forecast(latitude: float, longitude: float) -> str:
    """Get weather forecast for a location.

    Args:
        latitude: Latitude of the location
        longitude: Longitude of the location
    """
    # First get the forecast grid endpoint
    points_url = f"{NWS_API_BASE}/points/{latitude},{longitude}"
    points_data = await make_nws_request(points_url)

    if not points_data:
        return "Unable to fetch forecast data for this location."

    # Get the forecast URL from the points response
    forecast_url = points_data["properties"]["forecast"]
    forecast_data = await make_nws_request(forecast_url)

    if not forecast_data:
        return "Unable to fetch detailed forecast."

    # Format the periods into a readable forecast
    periods = forecast_data["properties"]["periods"]
    forecasts = []
    for period in periods[:5]:  # Only show next 5 periods
        forecast = f"""
{period['name']}:
Temperature: {period['temperature']}°{period['temperatureUnit']}
Wind: {period['windSpeed']} {period['windDirection']}
Forecast: {period['detailedForecast']}
"""
        forecasts.append(forecast)

    return "\n---\n".join(forecasts)

@mcp.tool()
async def get_coordinates(city: str, state: str = "", country: str = "US", zip_code: str = "") -> str:
    """Get latitude and longitude for a location using OpenWeather Geocoding API.

    Args:
        city: City name
        state: State code (optional, for US)
        country: Country code (default US)
        zip_code: Zip/post code (optional)
    """
    api_key = os.getenv("OPENWEATHER_API_KEY")
    if not api_key:
        return "OpenWeather API key not set. Please set OPENWEATHER_API_KEY in environment."
    async with httpx.AsyncClient() as client:
        if zip_code:
            url = f"http://api.openweathermap.org/geo/1.0/zip?zip={zip_code},{country}&appid={api_key}"
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                return f"Latitude: {data['lat']}, Longitude: {data['lon']}"
            else:
                return f"Error: Could not find coordinates for zip {zip_code}"
        else:
            q = city
            if state:
                q += f",{state}"
            if country:
                q += f",{country}"
            url = f"http://api.openweathermap.org/geo/1.0/direct?q={q}&limit=1&appid={api_key}"
            resp = await client.get(url)
            if resp.status_code == 200 and resp.json():
                data = resp.json()[0]
                return f"Latitude: {data['lat']}, Longitude: {data['lon']}"
            else:
                return f"Error: Could not find coordinates for {q}"

if __name__ == "__main__":
    # Initialize and run the server
    mcp.run(transport='stdio')
