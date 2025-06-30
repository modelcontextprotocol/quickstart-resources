// LangGPT Prompt Generator Examples
// 展示如何使用LangGPT Prompt生成助手生成不同类型的prompt

// 导入生成函数（在实际项目中需要正确导入）
// import { generateSpecificPrompt } from '../src/index';

// 示例1: 生成数学导师prompt
export const mathTutorExample = {
  type: 'tutor',
  details: {
    subject: '数学',
    author: 'AI数学导师',
    language: '中文',
    description: '专业的数学导师，帮助学生掌握数学知识和技能'
  }
};

// 示例2: 生成编程助手prompt
export const codingAssistantExample = {
  type: 'assistant',
  details: {
    role: '编程助手',
    author: 'AI编程专家',
    language: '中文',
    description: '专业的编程助手，提供代码编写和调试帮助',
    skills: [
      '代码编写和优化',
      '问题调试和错误修复',
      '最佳实践建议',
      '代码审查和重构',
      '技术选型指导'
    ]
  }
};

// 示例3: 生成AI专家prompt
export const aiExpertExample = {
  type: 'expert',
  details: {
    field: '人工智能',
    author: 'AI领域专家',
    language: '中文',
    description: '在人工智能领域拥有丰富经验和深度知识的专家'
  }
};

// 示例4: 生成英语学习导师prompt
export const englishTutorExample = {
  type: 'tutor',
  details: {
    subject: '英语',
    author: 'AI英语导师',
    language: '中文/English',
    description: '专业的英语导师，帮助学生提升英语听说读写能力'
  }
};

// 示例5: 生成商业顾问prompt
export const businessConsultantExample = {
  type: 'expert',
  details: {
    field: '商业咨询',
    author: 'AI商业顾问',
    language: '中文',
    description: '专业的商业顾问，提供战略规划和业务发展建议'
  }
};

// 示例6: 生成创意写作助手prompt
export const creativeWritingAssistantExample = {
  type: 'assistant',
  details: {
    role: '创意写作助手',
    author: 'AI创意专家',
    language: '中文',
    description: '专业的创意写作助手，帮助激发创意和提升写作技巧',
    skills: [
      '创意构思和头脑风暴',
      '故事结构和情节设计',
      '人物塑造和对话写作',
      '文学技巧和修辞手法',
      '写作风格和语言优化'
    ]
  }
};

// 使用示例函数
export function generatePromptExamples() {
  const examples = [
    mathTutorExample,
    codingAssistantExample,
    aiExpertExample,
    englishTutorExample,
    businessConsultantExample,
    creativeWritingAssistantExample
  ];

  console.log('=== LangGPT Prompt Generator Examples ===\n');

  examples.forEach((example, index) => {
    console.log(`示例 ${index + 1}: ${example.details.author || example.details.role || example.details.field}`);
    console.log(`类型: ${example.type}`);
    console.log(`描述: ${example.details.description}`);
    console.log('---');
  });

  return examples;
}

// 自定义prompt生成示例
export function generateCustomPromptExample() {
  const customRequirements = `
  我需要一个专门帮助初创公司进行产品定位和市场分析的AI助手。
  这个助手需要具备市场调研、竞品分析、用户画像分析等技能。
  目标用户是初创公司的创始人和产品经理。
  要求提供具体可操作的建议和策略。
  `;

  console.log('=== 自定义Prompt生成示例 ===');
  console.log('用户需求:', customRequirements);
  console.log('---');

  // 这里会调用 generateLangGPTPrompt(customRequirements)
  return customRequirements;
}

// 运行示例
if (require.main === module) {
  generatePromptExamples();
  generateCustomPromptExample();
} 