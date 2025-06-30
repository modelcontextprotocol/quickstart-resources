# LangGPT Prompt Generator Assistant

一个专门生成LangGPT格式结构化prompt的AI助手，基于[LangGPT框架](https://github.com/langgptai/LangGPT)设计。

## 功能特性

- 🚀 **结构化生成**: 严格按照LangGPT框架生成结构化prompt
- 🎯 **多种类型**: 支持导师(Tutor)、助手(Assistant)、专家(Expert)等多种类型
- 🌍 **双语支持**: 支持中英文双语prompt生成
- ⚡ **快速定制**: 根据用户需求快速生成定制化prompt
- 📝 **完整模板**: 包含Role、Profile、Skills、Rules、Workflow等完整组件

## LangGPT框架介绍

LangGPT是一个结构化的prompt设计框架，通过以下核心组件构建高质量的AI助手prompt：

### 核心组件

1. **Role (角色)**: 定义AI助手的身份和专业领域
2. **Profile (简介)**: 包含作者、版本、语言等基本信息
3. **Skills (技能)**: 列出AI助手需要具备的核心能力
4. **Rules (规则)**: 设定AI助手的行为准则和限制
5. **Workflow (工作流程)**: 设计AI助手的工作步骤和流程
6. **Initialization (初始化)**: 设定AI助手的开场白和初始指令

## 使用方法

### 1. 安装依赖

```bash
npm install
```

### 2. 构建项目

```bash
npm run build
```

### 3. 使用示例

#### 生成导师类型prompt

```typescript
// 生成数学导师prompt
const tutorPrompt = generateSpecificPrompt('tutor', {
  subject: '数学',
  author: 'AI数学导师',
  language: '中文'
});
```

#### 生成助手类型prompt

```typescript
// 生成通用助手prompt
const assistantPrompt = generateSpecificPrompt('assistant', {
  role: '编程助手',
  description: '专业的编程助手，提供代码编写和调试帮助',
  skills: ['代码编写', '问题调试', '最佳实践建议']
});
```

#### 生成专家类型prompt

```typescript
// 生成领域专家prompt
const expertPrompt = generateSpecificPrompt('expert', {
  field: '人工智能',
  author: 'AI领域专家',
  language: '中文'
});
```

## 生成的Prompt示例

### 导师类型示例

```markdown
# Role: 数学 Tutor

## Profile
- Author: AI数学导师
- Version: 1.0.0
- Language: 中文/English
- Description: 专业的数学导师，帮助学生掌握数学知识和技能

## Skills
- 深度理解数学核心概念和原理
- 能够根据学生水平调整教学难度
- 提供清晰的解释和实用的例子
- 设计互动练习和测试
- 跟踪学习进度并提供反馈

## Rules
1. 始终以学生为中心，关注学习效果
2. 使用清晰、易懂的语言解释复杂概念
3. 提供具体的例子和实践机会
4. 鼓励学生提问和思考
5. 保持耐心和积极的教学态度

## Workflow
1. **评估**: 了解学生的当前水平和学习目标
2. **规划**: 制定个性化的学习计划
3. **教学**: 通过多种方式传授知识
4. **练习**: 设计相关练习巩固学习
5. **反馈**: 提供建设性的反馈和建议
6. **调整**: 根据学习情况调整教学策略

## Initialization
你好！我是你的数学导师。我会帮助你掌握数学知识，提升你的学习效果。

请告诉我：
- 你当前的学习水平
- 你想要达到的目标
- 你遇到的具体困难

让我们开始这段学习之旅吧！
```

## 最佳实践

### 1. 明确需求
在生成prompt前，明确以下信息：
- AI助手的角色和身份
- 主要功能和技能要求
- 目标用户群体
- 特殊要求或限制

### 2. 优化调整
- 根据实际使用场景调整prompt复杂度
- 保持语言风格的一致性
- 定期更新和优化prompt内容

### 3. 测试验证
- 在实际对话中测试生成的prompt
- 根据反馈调整和优化
- 收集用户反馈持续改进

## 技术架构

- **语言**: TypeScript
- **框架**: Model Context Protocol (MCP)
- **设计模式**: 结构化prompt生成
- **扩展性**: 支持自定义prompt类型和模板

## 贡献指南

欢迎贡献代码和想法！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

ISC License

## 相关链接

- [LangGPT GitHub仓库](https://github.com/langgptai/LangGPT)
- [LangGPT官方文档](https://github.com/langgptai/LangGPT)
- [结构化Prompt设计指南](https://github.com/langgptai/LangGPT)

---

*让每个人都能成为prompt专家！🚀*

# MCP 天气服务器

一个基于 Model Context Protocol (MCP) 的天气信息服务器，提供当前天气、天气预报和天气建议等功能。

## 🌟 功能特性

### 🛠️ 工具 (Tools)

1. **get_current_weather** - 获取指定城市的当前天气信息
   - 参数：`city` (城市名称)
   - 返回：温度、天气状况、湿度、风速、能见度

2. **get_weather_forecast** - 获取指定城市的天气预报
   - 参数：`city` (城市名称), `days` (预报天数，1-5天)
   - 返回：未来几天的天气预报

3. **list_supported_cities** - 获取所有支持的城市列表
   - 参数：无
   - 返回：支持天气查询的城市列表

4. **get_weather_advice** - 根据当前天气提供出行建议
   - 参数：`city` (城市名称)
   - 返回：基于天气状况的出行建议

### 📚 资源 (Resources)

1. **weather://data/current** - 所有城市的当前天气数据 (JSON格式)
2. **weather://data/forecast** - 所有城市的天气预报数据 (JSON格式)
3. **weather://data/cities** - 支持的城市列表 (JSON格式)

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 构建项目

```bash
npm run build
```

### 运行服务器

```bash
npm start
```

### 运行测试

```bash
npm test
```

### 运行示例

```bash
npm run example
```

## 🎯 Cursor MCP 配置

### 快速设置

运行设置脚本：

```bash
./setup-cursor.sh
```

### 手动配置

1. **打开Cursor设置** (`Cmd/Ctrl + ,`)
2. **搜索 "MCP"** 或 "Model Context Protocol"
3. **找到 "MCP Servers"** 选项
4. **添加新的MCP服务器**：
   - 名称: `weather-server`
   - 命令: `node`
   - 参数: `build/index.js`
   - 工作目录: 项目根目录路径

### 配置文件方式

将以下内容添加到Cursor的 `settings.json`：

```json
{
  "mcp.servers": {
    "weather-server": {
      "command": "node",
      "args": ["build/index.js"],
      "cwd": "/path/to/your/weather-server-typescript"
    }
  }
}
```

### 测试MCP功能

配置完成后，在Cursor中尝试：

- "请告诉我北京的天气"
- "获取上海的天气预报"
- "列出所有支持的城市"
- "给我广州的天气建议"

详细配置说明请查看 [CURSOR_SETUP.md](CURSOR_SETUP.md)

## 📋 支持的城市

- 北京
- 上海
- 广州
- 深圳
- 杭州

## 🔧 技术架构

### 核心技术栈

- **TypeScript** - 主要开发语言
- **Model Context Protocol** - 协议标准
- **@modelcontextprotocol/sdk** - 官方SDK
- **Zod** - 参数验证
- **Node.js** - 运行环境

### 项目结构

```
weather-server-typescript/
├── src/
│   └── index.ts              # 主服务器文件
├── test/
│   └── test-weather-server.ts # 测试客户端
├── examples/
│   └── weather-client-example.ts # 使用示例
├── build/                    # 编译输出目录
├── package.json
├── tsconfig.json
├── .cursorrules              # Cursor规则文件
├── mcp-config.json           # MCP配置文件
├── setup-cursor.sh           # Cursor设置脚本
├── CURSOR_SETUP.md           # Cursor设置指南
└── README.md
```

## 📖 使用示例

### 作为MCP客户端

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// 创建客户端
const client = new Client({
  name: "my-weather-client",
  version: "1.0.0"
});

// 连接到服务器
const transport = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"]
});
await client.connect(transport);

// 获取北京天气
const result = await client.callTool({
  name: "get_current_weather",
  arguments: { city: "北京" }
});

console.log(result.content[0].text);
```

### 获取资源数据

```typescript
// 获取所有城市的当前天气数据
const currentData = await client.readResource({
  uri: "weather://data/current"
});

// 获取城市列表
const cities = await client.readResource({
  uri: "weather://data/cities"
});
```

## 🎯 数据格式

### 当前天气数据格式

```json
{
  "北京": {
    "temperature": 22,
    "condition": "晴天",
    "humidity": 45,
    "windSpeed": 12,
    "visibility": 10
  }
}
```

### 天气预报数据格式

```json
{
  "北京": [
    {
      "date": "2024-01-15",
      "high": 25,
      "low": 18,
      "condition": "晴天"
    }
  ]
}
```

## 🔒 错误处理

服务器包含完善的错误处理机制：

- **参数验证** - 使用Zod进行严格的参数验证
- **城市验证** - 只接受支持的城市名称
- **类型安全** - 完整的TypeScript类型定义
- **友好错误信息** - 提供清晰的错误提示

## 🧪 测试

项目包含完整的测试套件，测试覆盖：

- ✅ 工具功能测试
- ✅ 资源访问测试
- ✅ 错误处理测试
- ✅ 参数验证测试

运行测试：

```bash
npm test
```

## 🔄 扩展开发

### 添加新城市

在 `src/index.ts` 中的 `weatherData` 对象添加新城市数据：

```typescript
"新城市": {
  current: {
    temperature: 20,
    condition: "多云",
    humidity: 60,
    windSpeed: 10,
    visibility: 9
  },
  forecast: [
    // 添加5天预报数据
  ]
}
```

### 添加新工具

使用 `server.tool()` 方法注册新工具：

```typescript
server.tool(
  "new_tool_name",
  "工具描述",
  {
    // Zod参数定义
  },
  async (args) => {
    // 工具实现逻辑
    return {
      content: [{ type: "text", text: "结果" }]
    };
  }
);
```

### 添加新资源

使用 `server.resource()` 方法注册新资源：

```typescript
server.resource(
  "资源名称",
  "weather://data/new-resource",
  {
    description: "资源描述",
    mimeType: "application/json"
  },
  async () => {
    return {
      contents: [{
        uri: "weather://data/new-resource",
        mimeType: "application/json",
        text: JSON.stringify(data)
      }]
    };
  }
);
```

## 📄 许可证

本项目采用 MIT 许可证。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📚 相关链接

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP 规范](https://spec.modelcontextprotocol.io/)
- [Cursor MCP 设置指南](CURSOR_SETUP.md)

---

*让天气信息获取变得更加简单和智能！🌤️*
