/**
 * 默认 LLM 适配器
 *
 * 提供基础实现，使用者可以替换为自己的实现
 */

import type {
  LLMAdapter,
  LLMAdapterConfig,
  LLMOptions,
  Message,
  SummarizeConfig,
  LLMProvider,
} from './types';

/**
 * 创建 LLM 适配器
 */
export function createLLMAdapter(config: LLMAdapterConfig): LLMAdapter {
  if (config.customAdapter) {
    return config.customAdapter;
  }

  return new DefaultLLMAdapter(config);
}

/**
 * 默认 LLM 适配器
 *
 * 使用零 token 成本的结构化方法：
 * - summarize: 基于模板提取关键信息
 * - extract: 基于正则提取结构化数据
 * - complete/chat: 需要注入具体实现
 */
export class DefaultLLMAdapter implements LLMAdapter {
  private config: LLMAdapterConfig;

  constructor(config: LLMAdapterConfig) {
    this.config = config;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    throw new Error(
      `LLM complete 未实现。请通过 createLLMAdapter({ customAdapter }) 注入具体实现。` +
      `\n提供商: ${this.config.provider}, 模型: ${options?.model ?? this.config.model ?? '未指定'}`,
    );
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    throw new Error(
      `LLM chat 未实现。请通过 createLLMAdapter({ customAdapter }) 注入具体实现。` +
      `\n提供商: ${this.config.provider}, 消息数: ${messages.length}`,
    );
  }

  async *streamChat(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    throw new Error(
      `LLM streamChat 未实现。请通过 createLLMAdapter({ customAdapter }) 注入具体实现。`,
    );
  }

  /**
   * 结构化总结（零 token 成本，基于模板）
   */
  async summarize(messages: Message[], config: SummarizeConfig): Promise<string> {
    const parts: string[] = [];

    // 提取用户目标
    if (config.preserve.includes('user_goals')) {
      const userMessages = messages.filter(m => m.role === 'user');
      if (userMessages.length > 0) {
        parts.push('## 用户目标');
        for (const msg of userMessages.slice(-3)) {
          parts.push(`- ${msg.content.slice(0, 200)}`);
        }
      }
    }

    // 提取工具调用
    if (config.preserve.includes('tool_calls')) {
      const toolMessages = messages.filter(m => m.role === 'tool');
      if (toolMessages.length > 0) {
        parts.push('\n## 工具调用');
        parts.push(`共 ${toolMessages.length} 次工具调用`);
      }
    }

    // 提取错误
    if (config.preserve.includes('errors')) {
      const errorMessages = messages.filter(m =>
        m.content.toLowerCase().includes('error') ||
        m.content.toLowerCase().includes('failed'),
      );
      if (errorMessages.length > 0) {
        parts.push('\n## 错误');
        for (const msg of errorMessages.slice(-3)) {
          parts.push(`- ${msg.content.slice(0, 200)}`);
        }
      }
    }

    // 提取决策
    if (config.preserve.includes('decisions')) {
      const decisionMessages = messages.filter(m =>
        m.content.includes('决策') ||
        m.content.includes('decision') ||
        m.content.includes('选择') ||
        m.content.includes('方案'),
      );
      if (decisionMessages.length > 0) {
        parts.push('\n## 决策');
        for (const msg of decisionMessages.slice(-3)) {
          parts.push(`- ${msg.content.slice(0, 200)}`);
        }
      }
    }

    const summary = parts.join('\n');
    return summary.slice(0, config.maxTokens * 4); // 粗略字符/token 比
  }

  /**
   * 结构化提取（基于正则，零 token 成本）
   */
  async extract(content: string, schema: Record<string, unknown>): Promise<unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, type] of Object.entries(schema)) {
      if (typeof type === 'string') {
        // 简单类型提取
        const pattern = new RegExp(`${key}[:\\s]+(.+)`, 'i');
        const match = content.match(pattern);
        if (match) {
          result[key] = match[1].trim();
        }
      }
    }

    return result;
  }

  getProvider(): LLMProvider {
    return this.config.provider;
  }

  getModel(): string | undefined {
    return this.config.model;
  }
}
