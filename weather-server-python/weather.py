from typing import Any

import httpx2
from mcp.server import MCPServer
from pydantic import BaseModel, Field, RootModel

# Initialize the MCP server
mcp = MCPServer("weather")

# Constants
NWS_API_BASE = "https://api.weather.gov"
USER_AGENT = "weather-app/1.0"


class Alert(BaseModel):
    """One active weather alert."""

    event: str = Field(description="The kind of weather event")
    area: str = Field(description="The area the alert covers")
    severity: str = Field(description="How severe the event is")
    description: str = Field(description="What is happening")
    instructions: str = Field(description="What people in the area should do")


class Alerts(RootModel[list[Alert]]):
    """The output schema of get_alerts: a top-level array, not an object.

    A plain `-> list[Alert]` annotation would be wrapped as `{"result": [...]}`.
    A RootModel is a BaseModel, so it is taken as the schema as written, and a
    RootModel over a list serializes as the bare list. Revision 2026-07-28 is
    the first to allow a non-object root.
    """


class Period(BaseModel):
    """One period of a forecast."""

    name: str
    temperature: int
    temperature_unit: str
    wind_speed: str
    wind_direction: str
    detailed_forecast: str


class Forecast(BaseModel):
    """The output schema of get_forecast: the object case, for contrast."""

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


@mcp.tool()
async def get_alerts(state: str) -> Alerts:
    """Get weather alerts for a US state.

    Args:
        state: Two-letter US state code (e.g. CA, NY)
    """
    url = f"{NWS_API_BASE}/alerts/active/area/{state.upper()}"
    data = await make_nws_request(url)

    if not data or "features" not in data:
        raise ValueError(f"Unable to fetch alerts for {state.upper()}.")

    # An empty result is an empty array, not an error.
    #
    # `or` rather than a `get` default: NWS sends these fields as explicit
    # nulls rather than omitting them, and a default only covers a missing key.
    return Alerts(
        [
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


@mcp.tool()
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
        raise ValueError("Unable to fetch forecast data for this location.")

    # Get the forecast URL from the points response
    forecast_url = points_data["properties"]["forecast"]
    forecast_data = await make_nws_request(forecast_url)

    if not forecast_data:
        raise ValueError("Unable to fetch detailed forecast.")

    periods = forecast_data["properties"]["periods"][:5]  # Only show next 5 periods
    if not periods:
        raise ValueError("No forecast periods available.")

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
