package main

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	NWSAPIBase = "https://api.weather.gov"
	UserAgent  = "weather-app/1.0"
)

type ForecastInput struct {
	Latitude  float64 `json:"latitude" jsonschema:"Latitude of the location"`
	Longitude float64 `json:"longitude" jsonschema:"Longitude of the location"`
}

type AlertsInput struct {
	State string `json:"state" jsonschema:"Two-letter US state code (e.g. CA, NY)"`
}

type PointsResponse struct {
	Properties struct {
		Forecast string `json:"forecast"`
	} `json:"properties"`
}

type ForecastResponse struct {
	Properties struct {
		Periods []ForecastPeriod `json:"periods"`
	} `json:"properties"`
}

type ForecastPeriod struct {
	Name             string `json:"name"`
	Temperature      int    `json:"temperature"`
	TemperatureUnit  string `json:"temperatureUnit"`
	WindSpeed        string `json:"windSpeed"`
	WindDirection    string `json:"windDirection"`
	DetailedForecast string `json:"detailedForecast"`
}

type AlertsResponse struct {
	Features []AlertFeature `json:"features"`
}

type AlertFeature struct {
	Properties AlertProperties `json:"properties"`
}

type AlertProperties struct {
	Event       string `json:"event"`
	AreaDesc    string `json:"areaDesc"`
	Severity    string `json:"severity"`
	Description string `json:"description"`
	Instruction string `json:"instruction"`
}

// Alert is one element of get_alerts' structured output. Returning []Alert
// makes structuredContent a top-level JSON array rather than an object
// wrapping one, which protocol revision 2026-07-28 is the first to allow.
type Alert struct {
	Event        string `json:"event" jsonschema:"The kind of weather event"`
	Area         string `json:"area" jsonschema:"The area the alert covers"`
	Severity     string `json:"severity" jsonschema:"How severe the event is"`
	Description  string `json:"description" jsonschema:"What is happening"`
	Instructions string `json:"instructions" jsonschema:"What people in the area should do"`
}

// Period is one element of Forecast's periods. ForecastPeriod above is the
// shape NWS sends; this is the shape the tool publishes, kept separate for the
// same reason Alert is separate from AlertProperties.
type Period struct {
	Name             string `json:"name"`
	Temperature      int    `json:"temperature"`
	TemperatureUnit  string `json:"temperature_unit"`
	WindSpeed        string `json:"wind_speed"`
	WindDirection    string `json:"wind_direction"`
	DetailedForecast string `json:"detailed_forecast"`
}

// Forecast is get_forecast's structured output: the object case.
type Forecast struct {
	Latitude  float64  `json:"latitude" jsonschema:"Latitude the forecast is for"`
	Longitude float64  `json:"longitude" jsonschema:"Longitude the forecast is for"`
	Periods   []Period `json:"periods" jsonschema:"The forecast periods, soonest first"`
}

func makeNWSRequest[T any](ctx context.Context, url string) (*T, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/geo+json")

	client := http.DefaultClient
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request to %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP error %d: %s", resp.StatusCode, string(body))
	}

	var result T
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

func formatAlert(alert Alert) string {
	return fmt.Sprintf(`
Event: %s
Area: %s
Severity: %s
Description: %s
Instructions: %s
`, alert.Event, alert.Area, alert.Severity, alert.Description, alert.Instructions)
}

func formatPeriod(period ForecastPeriod) string {
	return fmt.Sprintf(`
%s:
Temperature: %d°%s
Wind: %s %s
Forecast: %s
`, period.Name, period.Temperature, period.TemperatureUnit,
		period.WindSpeed, period.WindDirection, period.DetailedForecast)
}

func getForecast(ctx context.Context, req *mcp.CallToolRequest, input ForecastInput) (
	*mcp.CallToolResult, Forecast, error,
) {
	// Get points data
	pointsURL := fmt.Sprintf("%s/points/%f,%f", NWSAPIBase, input.Latitude, input.Longitude)
	pointsData, err := makeNWSRequest[PointsResponse](ctx, pointsURL)
	if err != nil {
		return nil, Forecast{}, fmt.Errorf("unable to fetch forecast data for this location: %w", err)
	}

	// Get forecast data
	forecastURL := pointsData.Properties.Forecast
	if forecastURL == "" {
		return nil, Forecast{}, fmt.Errorf("unable to fetch forecast URL")
	}

	forecastData, err := makeNWSRequest[ForecastResponse](ctx, forecastURL)
	if err != nil {
		return nil, Forecast{}, fmt.Errorf("unable to fetch detailed forecast: %w", err)
	}

	periods := forecastData.Properties.Periods
	if len(periods) == 0 {
		return nil, Forecast{}, fmt.Errorf("no forecast periods available")
	}

	// Show next 5 periods
	periods = periods[:min(5, len(periods))]

	published := make([]Period, 0, len(periods))
	for _, period := range periods {
		published = append(published, Period{
			Name:             period.Name,
			Temperature:      period.Temperature,
			TemperatureUnit:  period.TemperatureUnit,
			WindSpeed:        period.WindSpeed,
			WindDirection:    period.WindDirection,
			DetailedForecast: period.DetailedForecast,
		})
	}

	forecast := Forecast{
		Latitude:  input.Latitude,
		Longitude: input.Longitude,
		Periods:   published,
	}

	var formatted []string
	for _, period := range periods {
		formatted = append(formatted, formatPeriod(period))
	}
	result := &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: strings.Join(formatted, "\n---\n")},
		},
	}

	return result, forecast, nil
}

// getAlerts returns []Alert, so the wire carries [{...}, {...}] and "no alerts"
// is simply [].
func getAlerts(ctx context.Context, req *mcp.CallToolRequest, input AlertsInput) (
	*mcp.CallToolResult, []Alert, error,
) {
	// Build alerts URL
	stateCode := strings.ToUpper(input.State)
	alertsURL := fmt.Sprintf("%s/alerts/active/area/%s", NWSAPIBase, stateCode)

	alertsData, err := makeNWSRequest[AlertsResponse](ctx, alertsURL)
	if err != nil {
		return nil, nil, fmt.Errorf("unable to fetch alerts for state %s: %w", stateCode, err)
	}

	// An empty result is an empty array, not an error.
	alerts := make([]Alert, 0, len(alertsData.Features))
	for _, feature := range alertsData.Features {
		props := feature.Properties
		alerts = append(alerts, Alert{
			Event:        cmp.Or(props.Event, "Unknown"),
			Area:         cmp.Or(props.AreaDesc, "Unknown"),
			Severity:     cmp.Or(props.Severity, "Unknown"),
			Description:  cmp.Or(props.Description, "No description available"),
			Instructions: cmp.Or(props.Instruction, "No specific instructions provided"),
		})
	}

	text := "No active alerts for this state."
	if len(alerts) > 0 {
		var formatted []string
		for _, alert := range alerts {
			formatted = append(formatted, formatAlert(alert))
		}
		text = strings.Join(formatted, "\n---\n")
	}

	result := &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
	}

	return result, alerts, nil
}

// alertsOutputSchema narrows the inferred root from ["null", "array"] to
// "array": a nil slice would marshal to null, but getAlerts always builds one.
func alertsOutputSchema() *jsonschema.Schema {
	schema, err := jsonschema.For[[]Alert](nil)
	if err != nil {
		log.Fatalf("inferring get_alerts output schema: %v", err)
	}
	schema.Types = nil
	schema.Type = "array"
	return schema
}

func main() {
	// Create MCP server
	server := mcp.NewServer(&mcp.Implementation{
		Name:    "weather",
		Version: "1.0.0",
	}, nil)

	// Add get_forecast tool
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_forecast",
		Description: "Get weather forecast for a location",
	}, getForecast)

	// Add get_alerts tool
	mcp.AddTool(server, &mcp.Tool{
		Name:         "get_alerts",
		Description:  "Get weather alerts for a US state",
		OutputSchema: alertsOutputSchema(),
	}, getAlerts)

	// Run server on stdio transport
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}
