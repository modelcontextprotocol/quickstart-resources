# frozen_string_literal: true

require "json"
require "mcp"
require "net/http"
require "uri"

NWS_API_BASE = "https://api.weather.gov"
USER_AGENT = "weather-app/1.0"

module HelperMethods
  def make_nws_request(url)
    uri = URI(url)
    request = Net::HTTP::Get.new(uri)
    request["User-Agent"] = USER_AGENT
    request["Accept"] = "application/geo+json"

    response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|
      http.request(request)
    end

    raise "HTTP #{response.code}: #{response.message}" unless response.is_a?(Net::HTTPSuccess)

    JSON.parse(response.body)
  end

  def format_alert(feature)
    properties = feature["properties"]

    <<~ALERT
      Event: #{properties["event"] || "Unknown"}
      Area: #{properties["areaDesc"] || "Unknown"}
      Severity: #{properties["severity"] || "Unknown"}
      Description: #{properties["description"] || "No description available"}
      Instructions: #{properties["instruction"] || "No specific instructions provided"}
    ALERT
  end
end

class GetAlerts < MCP::Tool
  extend HelperMethods

  tool_name "get_alerts"
  description "Get weather alerts for a US state"
  input_schema(
    properties: {
      state: {
        type: "string",
        description: "Two-letter US state code (e.g. CA, NY)"
      }
    },
    required: ["state"]
  )

  def self.call(state:)
    url = "#{NWS_API_BASE}/alerts/active/area/#{state.upcase}"
    data = make_nws_request(url)

    if data["features"].empty?
      return MCP::Tool::Response.new([{
        type: "text",
        text: "No active alerts for this state."
      }])
    end

    alerts = data["features"].map { |feature| format_alert(feature) }
    MCP::Tool::Response.new([{
      type: "text",
      text: alerts.join("\n---\n")
    }])
  end
end

class GetForecast < MCP::Tool
  extend HelperMethods

  tool_name "get_forecast"
  description "Get weather forecast for a location"
  input_schema(
    properties: {
      latitude: {
        type: "number",
        description: "Latitude of the location"
      },
      longitude: {
        type: "number",
        description: "Longitude of the location"
      }
    },
    required: ["latitude", "longitude"]
  )

  def self.call(latitude:, longitude:)
    # First get the forecast grid endpoint.
    points_url = "#{NWS_API_BASE}/points/#{latitude},#{longitude}"
    points_data = make_nws_request(points_url)

    # Get the forecast URL from the points response.
    forecast_url = points_data["properties"]["forecast"]
    forecast_data = make_nws_request(forecast_url)

    # Format the periods into a readable forecast.
    periods = forecast_data["properties"]["periods"]
    forecasts = periods.first(5).map do |period|
      <<~FORECAST
        #{period["name"]}:
        Temperature: #{period["temperature"]}°#{period["temperatureUnit"]}
        Wind: #{period["windSpeed"]} #{period["windDirection"]}
        Forecast: #{period["detailedForecast"]}
      FORECAST
    end

    MCP::Tool::Response.new([{
      type: "text",
      text: forecasts.join("\n---\n")
    }])
  end
end

server = MCP::Server.new(
  name: "weather",
  version: "1.0.0",
  tools: [GetAlerts, GetForecast]
)

transport = MCP::Server::Transports::StdioTransport.new(server)
transport.open
