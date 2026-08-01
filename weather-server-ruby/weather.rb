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

    response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 30) do |http|
      http.request(request)
    end

    raise "HTTP #{response.code}: #{response.message}" unless response.is_a?(Net::HTTPSuccess)

    JSON.parse(response.body)
  end

  def format_alert(alert)
    <<~ALERT
      Event: #{alert[:event]}
      Area: #{alert[:area]}
      Severity: #{alert[:severity]}
      Description: #{alert[:description]}
      Instructions: #{alert[:instructions]}
    ALERT
  end

  # A tool that declares an output schema MUST return conforming structured
  # content, so a failure path has to be an error result rather than a bare
  # text one. Error results are exempt from output schema validation.
  def error_response(text)
    MCP::Tool::Response.new([{ type: "text", text: text }], error: true)
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

  # A top-level array, not an object wrapping one. Declaring `type` at the root
  # suppresses the object default the SDK would otherwise apply, and revision
  # 2026-07-28 is the first to allow a non-object root.
  output_schema(
    type: "array",
    items: {
      type: "object",
      properties: {
        event: { type: "string", description: "The kind of weather event" },
        area: { type: "string", description: "The area the alert covers" },
        severity: { type: "string", description: "How severe the event is" },
        description: { type: "string", description: "What is happening" },
        instructions: { type: "string", description: "What people in the area should do" }
      },
      required: ["event", "area", "severity", "description", "instructions"]
    }
  )

  def self.call(state:, server_context: nil)
    data = begin
      make_nws_request("#{NWS_API_BASE}/alerts/active/area/#{state.upcase}")
    rescue => e
      return error_response("Unable to fetch alerts for #{state.upcase}: #{e.message}")
    end

    unless data.is_a?(Hash) && data["features"]
      return error_response("Unable to fetch alerts for #{state.upcase}.")
    end

    # An empty result is an empty array, not an error.
    alerts = data["features"].map do |feature|
      properties = feature["properties"] || {}
      {
        event: properties["event"] || "Unknown",
        area: properties["areaDesc"] || "Unknown",
        severity: properties["severity"] || "Unknown",
        description: properties["description"] || "No description available",
        instructions: properties["instruction"] || "No specific instructions provided"
      }
    end

    text = if alerts.empty?
      "No active alerts for this state."
    else
      alerts.map { |alert| format_alert(alert) }.join("\n---\n")
    end

    MCP::Tool::Response.new(
      [{ type: "text", text: text }],
      structured_content: alerts
    )
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

  # The object case, for contrast with get_alerts' array root.
  output_schema(
    type: "object",
    properties: {
      latitude: { type: "number", description: "Latitude the forecast is for" },
      longitude: { type: "number", description: "Longitude the forecast is for" },
      periods: {
        type: "array",
        description: "The forecast periods, soonest first",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            temperature: { type: "integer" },
            temperature_unit: { type: "string" },
            wind_speed: { type: "string" },
            wind_direction: { type: "string" },
            detailed_forecast: { type: "string" }
          },
          required: ["name", "temperature", "temperature_unit", "wind_speed", "wind_direction", "detailed_forecast"]
        }
      }
    },
    required: ["latitude", "longitude", "periods"]
  )

  def self.call(latitude:, longitude:, server_context: nil)
    forecast_data = begin
      # First get the forecast grid endpoint.
      points_data = make_nws_request("#{NWS_API_BASE}/points/#{latitude},#{longitude}")
      forecast_url = points_data.dig("properties", "forecast")
      return error_response("Unable to fetch forecast data for this location.") unless forecast_url

      make_nws_request(forecast_url)
    rescue => e
      return error_response("Unable to fetch forecast data for this location: #{e.message}")
    end

    # Only show the next 5 periods.
    periods = (forecast_data.dig("properties", "periods") || []).first(5)
    return error_response("No forecast periods available.") if periods.empty?

    forecast = {
      latitude: latitude,
      longitude: longitude,
      periods: periods.map do |period|
        {
          name: period["name"],
          temperature: period["temperature"],
          temperature_unit: period["temperatureUnit"],
          wind_speed: period["windSpeed"],
          wind_direction: period["windDirection"],
          detailed_forecast: period["detailedForecast"]
        }
      end
    }

    text = forecast[:periods].map do |period|
      <<~FORECAST
        #{period[:name]}:
        Temperature: #{period[:temperature]}°#{period[:temperature_unit]}
        Wind: #{period[:wind_speed]} #{period[:wind_direction]}
        Forecast: #{period[:detailed_forecast]}
      FORECAST
    end.join("\n---\n")

    MCP::Tool::Response.new(
      [{ type: "text", text: text }],
      structured_content: forecast
    )
  end
end

server = MCP::Server.new(
  name: "weather",
  version: "1.0.0",
  tools: [GetAlerts, GetForecast],
  # The gem otherwise advertises prompts, resources and logging as well. This
  # server has only tools, and logging is deprecated as of 2026-07-28
  # (SEP-2577). No listChanged: change notifications are delivered over
  # `subscriptions/listen`, which this server does not serve.
  capabilities: { tools: {} }
)

transport = MCP::Server::Transports::StdioTransport.new(server)
transport.open
