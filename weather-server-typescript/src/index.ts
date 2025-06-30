#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 定义天气数据类型
interface WeatherCurrent {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  visibility: number;
}

interface WeatherForecast {
  date: string;
  high: number;
  low: number;
  condition: string;
}

interface WeatherData {
  current: WeatherCurrent;
  forecast: WeatherForecast[];
}

interface WeatherDataMap {
  [city: string]: WeatherData;
}

// 模拟天气数据
const weatherData: WeatherDataMap = {
  "北京": {
    current: {
      temperature: 22,
      condition: "晴天",
      humidity: 45,
      windSpeed: 12,
      visibility: 10
    },
    forecast: [
      { date: "2024-01-15", high: 25, low: 18, condition: "晴天" },
      { date: "2024-01-16", high: 23, low: 16, condition: "多云" },
      { date: "2024-01-17", high: 20, low: 14, condition: "小雨" },
      { date: "2024-01-18", high: 22, low: 15, condition: "多云" },
      { date: "2024-01-19", high: 24, low: 17, condition: "晴天" }
    ]
  },
  "上海": {
    current: {
      temperature: 25,
      condition: "多云",
      humidity: 65,
      windSpeed: 8,
      visibility: 8
    },
    forecast: [
      { date: "2024-01-15", high: 20, low: 15, condition: "多云" },
      { date: "2024-01-16", high: 18, low: 12, condition: "小雨" },
      { date: "2024-01-17", high: 16, low: 10, condition: "中雨" },
      { date: "2024-01-18", high: 19, low: 13, condition: "多云" },
      { date: "2024-01-19", high: 21, low: 14, condition: "晴天" }
    ]
  },
  "广州": {
    current: {
      temperature: 25,
      condition: "晴天",
      humidity: 70,
      windSpeed: 5,
      visibility: 12
    },
    forecast: [
      { date: "2024-01-15", high: 27, low: 20, condition: "晴天" },
      { date: "2024-01-16", high: 26, low: 19, condition: "多云" },
      { date: "2024-01-17", high: 24, low: 18, condition: "小雨" },
      { date: "2024-01-18", high: 25, low: 19, condition: "多云" },
      { date: "2024-01-19", high: 28, low: 21, condition: "晴天" }
    ]
  },
  "深圳": {
    current: {
      temperature: 26,
      condition: "晴天",
      humidity: 68,
      windSpeed: 6,
      visibility: 15
    },
    forecast: [
      { date: "2024-01-15", high: 28, low: 21, condition: "晴天" },
      { date: "2024-01-16", high: 27, low: 20, condition: "多云" },
      { date: "2024-01-17", high: 25, low: 19, condition: "小雨" },
      { date: "2024-01-18", high: 26, low: 20, condition: "多云" },
      { date: "2024-01-19", high: 29, low: 22, condition: "晴天" }
    ]
  },
  "杭州": {
    current: {
      temperature: 20,
      condition: "多云",
      humidity: 60,
      windSpeed: 10,
      visibility: 9
    },
    forecast: [
      { date: "2024-01-15", high: 22, low: 16, condition: "多云" },
      { date: "2024-01-16", high: 20, low: 14, condition: "小雨" },
      { date: "2024-01-17", high: 18, low: 12, condition: "中雨" },
      { date: "2024-01-18", high: 21, low: 15, condition: "多云" },
      { date: "2024-01-19", high: 23, low: 17, condition: "晴天" }
    ]
  }
};

// 创建MCP服务器
const server = new McpServer({
  name: "weather-server",
  version: "1.0.0"
});

// 注册工具：获取当前天气
server.tool(
  "get_current_weather",
  "获取指定城市的当前天气信息",
  {
    city: z.enum(Object.keys(weatherData) as [string, ...string[]]).describe("城市名称")
  },
  async (args) => {
    const { city } = args;
    
    if (!weatherData[city]) {
      return {
        content: [{
          type: "text",
          text: `抱歉，没有找到城市 "${city}" 的天气信息。支持的城市包括：${Object.keys(weatherData).join(", ")}`
        }]
      };
    }

    const current = weatherData[city].current;
    const weatherText = `${city}当前天气：
温度：${current.temperature}°C
天气状况：${current.condition}
湿度：${current.humidity}%
风速：${current.windSpeed} km/h
能见度：${current.visibility} km`;

    return {
      content: [{
        type: "text",
        text: weatherText
      }]
    };
  }
);

// 注册工具：获取天气预报
server.tool(
  "get_weather_forecast",
  "获取指定城市的5天天气预报",
  {
    city: z.enum(Object.keys(weatherData) as [string, ...string[]]).describe("城市名称"),
    days: z.number().min(1).max(5).default(5).describe("预报天数（1-5天）")
  },
  async (args) => {
    const { city, days } = args;
    
    if (!weatherData[city]) {
      return {
        content: [{
          type: "text",
          text: `抱歉，没有找到城市 "${city}" 的天气信息。支持的城市包括：${Object.keys(weatherData).join(", ")}`
        }]
      };
    }

    const forecast = weatherData[city].forecast.slice(0, days);
    let forecastText = `${city}未来${days}天天气预报：\n\n`;
    
    forecast.forEach((day: WeatherForecast, index: number) => {
      forecastText += `${index + 1}. ${day.date}：${day.condition}，最高${day.high}°C，最低${day.low}°C\n`;
    });

    return {
      content: [{
        type: "text",
        text: forecastText
      }]
    };
  }
);

// 注册工具：获取所有支持的城市
server.tool(
  "list_supported_cities",
  "获取所有支持天气查询的城市列表",
  async () => {
    const cities = Object.keys(weatherData);
    return {
      content: [{
        type: "text",
        text: `支持的城市列表：\n${cities.map((city: string, index: number) => `${index + 1}. ${city}`).join('\n')}`
      }]
    };
  }
);

// 注册工具：获取天气建议
server.tool(
  "get_weather_advice",
  "根据当前天气提供出行建议",
  {
    city: z.enum(Object.keys(weatherData) as [string, ...string[]]).describe("城市名称")
  },
  async (args) => {
    const { city } = args;
    
    if (!weatherData[city]) {
      return {
        content: [{
          type: "text",
          text: `抱歉，没有找到城市 "${city}" 的天气信息。`
        }]
      };
    }

    const current = weatherData[city].current;
    let advice = `${city}天气建议：\n\n`;
    
    // 根据温度提供建议
    if (current.temperature < 10) {
      advice += "🌡️ 温度较低，建议穿厚外套，注意保暖\n";
    } else if (current.temperature > 30) {
      advice += "🌡️ 温度较高，建议穿轻薄衣物，注意防暑\n";
    } else {
      advice += "🌡️ 温度适宜，建议穿舒适衣物\n";
    }
    
    // 根据天气状况提供建议
    if (current.condition.includes("雨")) {
      advice += "☔ 有雨，建议携带雨伞，注意路面湿滑\n";
    } else if (current.condition.includes("雪")) {
      advice += "❄️ 有雪，建议穿防滑鞋，注意保暖\n";
    } else if (current.condition.includes("晴")) {
      advice += "☀️ 晴天，适合户外活动，注意防晒\n";
    } else if (current.condition.includes("云")) {
      advice += "☁️ 多云，天气适宜，适合各种活动\n";
    }
    
    // 根据风速提供建议
    if (current.windSpeed > 20) {
      advice += "💨 风速较大，注意防风，避免高空作业\n";
    }
    
    // 根据能见度提供建议
    if (current.visibility < 5) {
      advice += "🌫️ 能见度较低，驾驶时注意安全\n";
    }

    return {
      content: [{
        type: "text",
        text: advice
      }]
    };
  }
);

// 注册资源：当前天气数据
server.resource(
  "当前天气数据",
  "weather://data/current",
  {
    description: "所有城市的当前天气数据",
    mimeType: "application/json"
  },
  async () => {
    const currentData: { [city: string]: WeatherCurrent } = {};
    for (const [city, data] of Object.entries(weatherData)) {
      currentData[city] = data.current;
    }
    
    return {
      contents: [{
        uri: "weather://data/current",
        mimeType: "application/json",
        text: JSON.stringify(currentData, null, 2)
      }]
    };
  }
);

// 注册资源：天气预报数据
server.resource(
  "天气预报数据",
  "weather://data/forecast",
  {
    description: "所有城市的5天天气预报数据",
    mimeType: "application/json"
  },
  async () => {
    const forecastData: { [city: string]: WeatherForecast[] } = {};
    for (const [city, data] of Object.entries(weatherData)) {
      forecastData[city] = data.forecast;
    }
    
    return {
      contents: [{
        uri: "weather://data/forecast",
        mimeType: "application/json",
        text: JSON.stringify(forecastData, null, 2)
      }]
    };
  }
);

// 注册资源：城市列表
server.resource(
  "支持的城市列表",
  "weather://data/cities",
  {
    description: "所有支持天气查询的城市",
    mimeType: "application/json"
  },
  async () => {
    return {
      contents: [{
        uri: "weather://data/cities",
        mimeType: "application/json",
        text: JSON.stringify({
          cities: Object.keys(weatherData),
          count: Object.keys(weatherData).length
        }, null, 2)
      }]
    };
  }
);

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("天气MCP服务器已启动，支持以下功能：");
console.error("- 获取当前天气 (get_current_weather)");
console.error("- 获取天气预报 (get_weather_forecast)");
console.error("- 列出支持的城市 (list_supported_cities)");
console.error("- 获取天气建议 (get_weather_advice)");
console.error("- 访问天气数据资源 (weather://data/*)"); 