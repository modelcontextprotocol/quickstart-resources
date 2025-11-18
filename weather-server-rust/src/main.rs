use anyhow::Result;
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, tool::Parameters},
    model::*,
    schemars, tool, tool_handler, tool_router,
};
use serde::Deserialize;
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

fn format_alert(feature: &AlertFeature) -> String {
    let props = &feature.properties;
    format!(
        "Event: {}\nArea: {}\nSeverity: {}\nDescription: {}\nInstructions: {}",
        props.event.as_deref().unwrap_or("Unknown"),
        props.area_desc.as_deref().unwrap_or("Unknown"),
        props.severity.as_deref().unwrap_or("Unknown"),
        props
            .description
            .as_deref()
            .unwrap_or("No description available"),
        props
            .instruction
            .as_deref()
            .unwrap_or("No specific instructions provided")
    )
}

fn format_period(period: &ForecastPeriod) -> String {
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

#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct MCPForecastRequest {
    latitude: f32,
    longitude: f32,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct MCPAlertRequest {
    state: String,
}

pub struct Weather {
    tool_router: ToolRouter<Weather>,
}

#[tool_router]
impl Weather {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }

    #[tool(description = "Get weather alerts for a US state.")]
    async fn get_alerts(
        &self,
        Parameters(MCPAlertRequest { state }): Parameters<MCPAlertRequest>,
    ) -> String {
        let url = format!(
            "{}/alerts/active/area/{}",
            NWS_API_BASE,
            state.to_uppercase()
        );

        match make_nws_request::<AlertsResponse>(&url).await {
            Ok(data) => {
                if data.features.is_empty() {
                    "No active alerts for this state.".to_string()
                } else {
                    data.features
                        .iter()
                        .map(format_alert)
                        .collect::<Vec<_>>()
                        .join("\n---\n")
                }
            }
            Err(_) => "Unable to fetch alerts or no alerts found.".to_string(),
        }
    }

    #[tool(description = "Get weather forecast for a location.")]
    async fn get_forecast(
        &self,
        Parameters(MCPForecastRequest {
            latitude,
            longitude,
        }): Parameters<MCPForecastRequest>,
    ) -> String {
        let points_url = format!("{NWS_API_BASE}/points/{latitude},{longitude}");
        let Ok(points_data) = make_nws_request::<PointsResponse>(&points_url).await else {
            return "Unable to fetch forecast data for this location.".to_string();
        };

        let forecast_url = points_data.properties.forecast;

        let Ok(forecast_data) = make_nws_request::<ForecastResponse>(&forecast_url).await else {
            return "Unable to fetch forecast data for this location.".to_string();
        };

        let periods = &forecast_data.properties.periods;
        let forecast_summary: String = periods
            .iter()
            .take(5) // Next 5 periods only
            .map(format_period)
            .collect::<Vec<String>>()
            .join("\n---\n");
        forecast_summary
    }
}

#[tool_handler]
impl ServerHandler for Weather {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let transport = (tokio::io::stdin(), tokio::io::stdout());
    let service = Weather::new().serve(transport).await?;
    service.waiting().await?;
    Ok(())
}
