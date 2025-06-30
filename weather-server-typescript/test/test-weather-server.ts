#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";

async function testWeatherServer() {
  console.log("🚀 启动MCP天气服务器测试...\n");

  // 启动服务器进程
  const serverProcess = spawn("node", ["build/index.js"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  // 创建客户端传输
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/index.js"]
  });

  // 创建客户端
  const client = new Client({
    name: "weather-test-client",
    version: "1.0.0"
  });

  try {
    // 连接到服务器
    await client.connect(transport);
    console.log("✅ 成功连接到MCP天气服务器\n");

    // 测试1: 列出支持的城市
    console.log("📋 测试1: 列出支持的城市");
    const citiesResult = await client.callTool({
      name: "list_supported_cities",
      arguments: {}
    });
    console.log("结果:", citiesResult.content[0].text);
    console.log();

    // 测试2: 获取北京的当前天气
    console.log("🌤️ 测试2: 获取北京的当前天气");
    const currentWeatherResult = await client.callTool({
      name: "get_current_weather",
      arguments: {
        city: "北京"
      }
    });
    console.log("结果:", currentWeatherResult.content[0].text);
    console.log();

    // 测试3: 获取上海的天气预报
    console.log("📅 测试3: 获取上海的3天天气预报");
    const forecastResult = await client.callTool({
      name: "get_weather_forecast",
      arguments: {
        city: "上海",
        days: 3
      }
    });
    console.log("结果:", forecastResult.content[0].text);
    console.log();

    // 测试4: 获取广州的天气建议
    console.log("💡 测试4: 获取广州的天气建议");
    const adviceResult = await client.callTool({
      name: "get_weather_advice",
      arguments: {
        city: "广州"
      }
    });
    console.log("结果:", adviceResult.content[0].text);
    console.log();

    // 测试5: 获取资源 - 当前天气数据
    console.log("📊 测试5: 获取当前天气数据资源");
    const currentDataResult = await client.readResource({
      uri: "weather://data/current"
    });
    console.log("资源内容:", currentDataResult.contents[0].text.substring(0, 200) + "...");
    console.log();

    // 测试6: 获取资源 - 城市列表
    console.log("🏙️ 测试6: 获取城市列表资源");
    const citiesDataResult = await client.readResource({
      uri: "weather://data/cities"
    });
    console.log("资源内容:", citiesDataResult.contents[0].text);
    console.log();

    // 测试7: 测试错误处理 - 不存在的城市
    console.log("❌ 测试7: 测试错误处理 - 查询不存在的城市");
    try {
      const errorResult = await client.callTool({
        name: "get_current_weather",
        arguments: {
          city: "火星"
        }
      });
      console.log("结果:", errorResult.content[0].text);
    } catch (error) {
      console.log("错误:", error);
    }
    console.log();

    console.log("🎉 所有测试完成！");

  } catch (error) {
    console.error("❌ 测试过程中发生错误:", error);
  } finally {
    // 关闭连接
    await client.close();
    serverProcess.kill();
    console.log("🔌 已关闭连接");
  }
}

// 运行测试
testWeatherServer().catch(console.error); 