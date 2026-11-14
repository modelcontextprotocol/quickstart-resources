from typing import Any

import httpx2
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field

# Initialize the MCP server
mcp = MCPServer("weather")

# Constants
NWS_API_BASE = "https://api.weather.gov"
USER_AGENT = "weather-app/1.0"

# Hints for hosts: both tools only read data, and they read it from an outside
# service (the NWS API). Hints are not guarantees; a host decides how far to
# trust them.
WEATHER_TOOL_ANNOTATIONS = ToolAnnotations(
    read_only_hint=True,
    destructive_hint=False,
    idempotent_hint=True,
    open_world_hint=True,
)


class Alert(BaseModel):
    """One active weather alert."""

    event: str = Field(description="The kind of weather event")
    area: str = Field(description="The area the alert covers")
    severity: str = Field(description="How severe the event is")
    description: str = Field(description="What is happening")
    instructions: str = Field(description="What people in the area should do")


class Alerts(BaseModel):
    """The output schema of get_alerts.

    Revision 2026-07-28 allows a top-level array here, but 2025-11-25 clients
    reject one, and the SDK does not yet convert it for them, so wrap the list.
    """

    alerts: list[Alert] = Field(description="Active alerts, empty if there are none")


class Period(BaseModel):
    """One period of a forecast."""

    name: str = Field(description="Label for the period, e.g. Tonight or Tuesday")
    temperature: int = Field(description="Forecast temperature")
    temperature_unit: str = Field(description="Unit of the temperature, F or C")
    wind_speed: str = Field(description="Wind speed, e.g. 10 to 15 mph")
    wind_direction: str = Field(description="Wind direction as a compass point")
    detailed_forecast: str = Field(description="Prose description of the period")


class Forecast(BaseModel):
    """The output schema of get_forecast."""

    latitude: float = Field(description="Latitude the forecast is for")
    longitude: float = Field(description="Longitude the forecast is for")
    periods: list[Period] = Field(description="The forecast periods, soonest first")


async def make_nws_request(url: str) -> dict[str, Any] | None:
    """Make a request to the NWS API with proper error handling."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/geo+json"}
    async with httpx2.AsyncClient() as client:
        try:
            response = await client.get(url, headers=headers, timeout=30.0)
            response.raise_for_status()
            return response.json()
        except Exception:
            return None


@mcp.tool(annotations=WEATHER_TOOL_ANNOTATIONS)
async def get_alerts(state: str) -> Alerts:
    """Get weather alerts for a US state.

    Args:
        state: Two-letter US state code (e.g. CA, NY)
    """
    url = f"{NWS_API_BASE}/alerts/active/area/{state.upper()}"
    data = await make_nws_request(url)

    if not data or "features" not in data:
        raise ToolError(f"Unable to fetch alerts for {state.upper()}.")

    # No alerts is an empty list, not an error.
    #
    # `or` rather than a `get` default: NWS sends these fields as explicit
    # nulls rather than omitting them, and a default only covers a missing key.
    return Alerts(
        alerts=[
            Alert(
                event=props.get("event") or "Unknown",
                area=props.get("areaDesc") or "Unknown",
                severity=props.get("severity") or "Unknown",
                description=props.get("description") or "No description available",
                instructions=props.get("instruction") or "No specific instructions provided",
            )
            for props in (feature["properties"] for feature in data["features"])
        ]
    )


@mcp.tool(annotations=WEATHER_TOOL_ANNOTATIONS)
async def get_forecast(latitude: float, longitude: float) -> Forecast:
    """Get weather forecast for a location.

    Args:
        latitude: Latitude of the location
        longitude: Longitude of the location
    """
    # First get the forecast grid endpoint
    points_url = f"{NWS_API_BASE}/points/{latitude},{longitude}"
    points_data = await make_nws_request(points_url)

    if not points_data:
        raise ToolError("Unable to fetch forecast data for this location.")

    # Get the forecast URL from the points response
    forecast_url = points_data["properties"]["forecast"]
    forecast_data = await make_nws_request(forecast_url)

    if not forecast_data:
        raise ToolError("Unable to fetch detailed forecast.")

    periods = forecast_data["properties"]["periods"][:5]  # Only show next 5 periods
    if not periods:
        raise ToolError("No forecast periods available.")

    return Forecast(
        latitude=latitude,
        longitude=longitude,
        periods=[
            Period(
                name=period["name"],
                temperature=period["temperature"],
                temperature_unit=period["temperatureUnit"],
                wind_speed=period["windSpeed"],
                wind_direction=period["windDirection"],
                detailed_forecast=period["detailedForecast"],
            )
            for period in periods
        ],
    )


def main():
    # Initialize and run the server
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
