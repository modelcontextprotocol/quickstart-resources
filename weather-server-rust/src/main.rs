use anyhow::Result;
use rmcp::{
    ErrorData, ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, tool::schema_for_output, wrapper::Parameters},
    model::*,
    schemars::{self, JsonSchema},
    tool, tool_handler, tool_router,
    transport::stdio,
};
use serde::Deserialize;
use serde::Serialize;
use serde::de::DeserializeOwned;

const NWS_API_BASE: &str = "https://api.weather.gov";
const USER_AGENT: &str = "weather-app/1.0";

#[derive(Debug, Deserialize)]
struct AlertsResponse {
    features: Vec<AlertFeature>,
}

#[derive(Debug, Deserialize)]
struct AlertFeature {
    properties: AlertProperties,
}

#[derive(Debug, Deserialize)]
struct AlertProperties {
    event: Option<String>,
    #[serde(rename = "areaDesc")]
    area_desc: Option<String>,
    severity: Option<String>,
    description: Option<String>,
    instruction: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PointsResponse {
    properties: PointsProperties,
}

#[derive(Debug, Deserialize)]
struct PointsProperties {
    forecast: String,
}

#[derive(Debug, Deserialize)]
struct ForecastResponse {
    properties: ForecastProperties,
}

#[derive(Debug, Deserialize)]
struct ForecastProperties {
    periods: Vec<ForecastPeriod>,
}

#[derive(Debug, Deserialize)]
struct ForecastPeriod {
    name: String,
    temperature: i32,
    #[serde(rename = "temperatureUnit")]
    temperature_unit: String,
    #[serde(rename = "windSpeed")]
    wind_speed: String,
    #[serde(rename = "windDirection")]
    wind_direction: String,
    #[serde(rename = "detailedForecast")]
    detailed_forecast: String,
}

/// `get_alerts`' structured content. Revision 2026-07-28 allows a top-level
/// array, but 2025-11-25 clients reject one, and rmcp does not yet convert it
/// for them, so wrap the list.
#[derive(Debug, Serialize, JsonSchema)]
pub struct Alerts {
    /// Active alerts, empty if there are none.
    alerts: Vec<Alert>,
}

/// One element of `Alerts`.
#[derive(Debug, Serialize, JsonSchema)]
pub struct Alert {
    /// The kind of weather event.
    event: String,
    /// The area the alert covers.
    area: String,
    /// How severe the event is.
    severity: String,
    /// What is happening.
    description: String,
    /// What people in the area should do.
    instructions: String,
}

/// `get_forecast`' structured content.
#[derive(Debug, Serialize, JsonSchema)]
pub struct Forecast {
    /// Latitude the forecast is for.
    latitude: f32,
    /// Longitude the forecast is for.
    longitude: f32,
    /// The forecast periods, soonest first.
    periods: Vec<Period>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct Period {
    name: String,
    temperature: i32,
    temperature_unit: String,
    wind_speed: String,
    wind_direction: String,
    detailed_forecast: String,
}

async fn make_nws_request<T: DeserializeOwned>(url: &str) -> Result<T> {
    let client = reqwest::Client::new();
    let rsp = client
        .get(url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/geo+json")
        .send()
        .await?
        .error_for_status()?;
    Ok(rsp.json::<T>().await?)
}

fn format_alert(alert: &Alert) -> String {
    format!(
        "Event: {}\nArea: {}\nSeverity: {}\nDescription: {}\nInstructions: {}",
        alert.event, alert.area, alert.severity, alert.description, alert.instructions
    )
}

fn format_period(period: &Period) -> String {
    format!(
        "{}:\nTemperature: {}°{}\nWind: {} {}\nForecast: {}",
        period.name,
        period.temperature,
        period.temperature_unit,
        period.wind_speed,
        period.wind_direction,
        period.detailed_forecast
    )
}

/// Build a result carrying both channels.
fn dual_channel_result(
    text: String,
    structured: impl Serialize,
) -> Result<CallToolResult, ErrorData> {
    let value = serde_json::to_value(structured).map_err(|e| {
        ErrorData::internal_error(format!("failed to serialize structured content: {e}"), None)
    })?;
    let mut result = CallToolResult::success(vec![ContentBlock::text(text)]);
    result.structured_content = Some(value);
    Ok(result)
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct MCPForecastRequest {
    /// Latitude of the location.
    latitude: f32,
    /// Longitude of the location.
    longitude: f32,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct MCPAlertRequest {
    /// Two-letter US state code (e.g. CA, NY).
    state: String,
}

#[derive(Clone)]
pub struct Weather {
    tool_router: ToolRouter<Weather>,
}

// Both tools carry the same annotations, hints for hosts: they only read data,
// and they read it from an outside service (the NWS API). Hints are not
// guarantees; a host decides how far to trust them.
#[tool_router(router = tool_router)]
impl Weather {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }

    #[tool(
        description = "Get weather alerts for a US state.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = true
        ),
        output_schema = schema_for_output::<Alerts>()
    )]
    async fn get_alerts(
        &self,
        Parameters(MCPAlertRequest { state }): Parameters<MCPAlertRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let state = state.to_uppercase();
        let url = format!("{NWS_API_BASE}/alerts/active/area/{state}");

        let Ok(data) = make_nws_request::<AlertsResponse>(&url).await else {
            return Ok(CallToolResult::error(vec![ContentBlock::text(format!(
                "Unable to fetch alerts for {state}."
            ))]));
        };

        // No alerts is an empty list, not an error.
        let alerts: Vec<Alert> = data
            .features
            .into_iter()
            .map(|feature| {
                let props = feature.properties;
                Alert {
                    event: props.event.unwrap_or_else(|| "Unknown".into()),
                    area: props.area_desc.unwrap_or_else(|| "Unknown".into()),
                    severity: props.severity.unwrap_or_else(|| "Unknown".into()),
                    description: props
                        .description
                        .unwrap_or_else(|| "No description available".into()),
                    instructions: props
                        .instruction
                        .unwrap_or_else(|| "No specific instructions provided".into()),
                }
            })
            .collect();

        let text = if alerts.is_empty() {
            "No active alerts for this state.".to_string()
        } else {
            alerts
                .iter()
                .map(format_alert)
                .collect::<Vec<_>>()
                .join("\n---\n")
        };

        dual_channel_result(text, Alerts { alerts })
    }

    #[tool(
        description = "Get weather forecast for a location.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = true
        ),
        output_schema = schema_for_output::<Forecast>()
    )]
    async fn get_forecast(
        &self,
        Parameters(MCPForecastRequest {
            latitude,
            longitude,
        }): Parameters<MCPForecastRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let points_url = format!("{NWS_API_BASE}/points/{latitude},{longitude}");
        let Ok(points_data) = make_nws_request::<PointsResponse>(&points_url).await else {
            return Ok(CallToolResult::error(vec![ContentBlock::text(
                "Unable to fetch forecast data for this location.",
            )]));
        };

        let forecast_url = points_data.properties.forecast;
        let Ok(forecast_data) = make_nws_request::<ForecastResponse>(&forecast_url).await else {
            return Ok(CallToolResult::error(vec![ContentBlock::text(
                "Unable to fetch detailed forecast.",
            )]));
        };

        let forecast = Forecast {
            latitude,
            longitude,
            periods: forecast_data
                .properties
                .periods
                .into_iter()
                .take(5) // Next 5 periods only
                .map(|p| Period {
                    name: p.name,
                    temperature: p.temperature,
                    temperature_unit: p.temperature_unit,
                    wind_speed: p.wind_speed,
                    wind_direction: p.wind_direction,
                    detailed_forecast: p.detailed_forecast,
                })
                .collect(),
        };

        let text = forecast
            .periods
            .iter()
            .map(format_period)
            .collect::<Vec<_>>()
            .join("\n---\n");

        dual_channel_result(text, &forecast)
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for Weather {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::default();
        // Without this the server reports rmcp's own crate name and version
        // rather than its own.
        info.server_info = Implementation::new("weather", "1.0.0");
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let service = Weather::new().serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
