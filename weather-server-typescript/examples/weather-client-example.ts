#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/**
 * MCP天气客户端使用示例
 * 
 * 这个示例展示了如何连接到MCP天气服务器并调用各种工具和资源
 */

async function weatherClientExample() {
  console.log("🌤️ MCP天气客户端示例\n");

  // 创建客户端
  const client = new Client({
    name: "weather-example-client",
    version: "1.0.0"
  });

  // 获取当前文件目录
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // 创建传输层 - 修复路径
  const serverPath = join(__dirname, "..", "build", "index.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath]
  });

  try {
    // 连接到服务器
    await client.connect(transport);
    console.log("✅ 成功连接到MCP天气服务器\n");

    // 示例1: 获取支持的城市列表
    console.log("📋 示例1: 获取支持的城市列表");
    const cities = await client.callTool({
      name: "list_supported_cities",
      arguments: {}
    });
    console.log((cities.content as any[])[0].text);
    console.log();

    // 示例2: 获取多个城市的当前天气
    console.log("🌡️ 示例2: 获取多个城市的当前天气");
    const citiesList = ["北京", "上海", "广州"];
    
    for (const city of citiesList) {
      const weather = await client.callTool({
        name: "get_current_weather",
        arguments: { city }
      });
      console.log((weather.content as any[])[0].text);
      console.log();
    }

    // 示例3: 获取天气预报
    console.log("📅 示例3: 获取深圳的5天天气预报");
    const forecast = await client.callTool({
      name: "get_weather_forecast",
      arguments: { 
        city: "深圳", 
        days: 5 
      }
    });
    console.log((forecast.content as any[])[0].text);
    console.log();

    // 示例4: 获取天气建议
    console.log("💡 示例4: 获取杭州的天气建议");
    const advice = await client.callTool({
      name: "get_weather_advice",
      arguments: { city: "杭州" }
    });
    console.log((advice.content as any[])[0].text);
    console.log();

    // 示例5: 获取资源数据
    console.log("📊 示例5: 获取所有城市的当前天气数据");
    const currentData = await client.readResource({
      uri: "weather://data/current"
    });
    
    const weatherData = JSON.parse((currentData.contents as any[])[0].text);
    console.log("当前天气数据概览:");
    Object.entries(weatherData).forEach(([city, data]: [string, any]) => {
      console.log(`  ${city}: ${data.temperature}°C, ${data.condition}`);
    });
    console.log();

    // 示例6: 批量获取天气建议
    console.log("🎯 示例6: 批量获取所有城市的天气建议");
    const allCities = Object.keys(weatherData);
    
    for (const city of allCities) {
      const cityAdvice = await client.callTool({
        name: "get_weather_advice",
        arguments: { city }
      });
      console.log(`${city}: ${(cityAdvice.content as any[])[0].text.split('\n')[2]}`); // 只显示温度建议
    }
    console.log();

    console.log("🎉 示例运行完成！");

  } catch (error) {
    console.error("❌ 运行示例时发生错误:", error);
  } finally {
    // 关闭连接
    await client.close();
    console.log("🔌 已关闭连接");
  }
}

// 运行示例
weatherClientExample().catch(console.error); 