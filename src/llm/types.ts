/**
 * LLM 适配器类型定义
 *
 * harness 核心不硬编码 LLM 依赖，通过接口注入
 */

// ── 消息类型 ─────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

// ── LLM 选项 ─────────────────────────────────────────────

export interface LLMOptions {
  /** 模型名称 */
  model?: string;
  /** 温度 */
  temperature?: number;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 停止序列 */
  stop?: string[];
  /** 工具定义（function calling） */
  tools?: LLMToolSpec[];
}

export interface LLMToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ── 总结配置 ─────────────────────────────────────────────

export interface SummarizeConfig {
  /** 目标 token 数 */
  maxTokens: number;
  /** 保留的关键信息 */
  preserve: Array<'user_goals' | 'tool_calls' | 'errors' | 'decisions'>;
}

// ── 提取配置 ─────────────────────────────────────────────

export interface ExtractConfig {
  /** 目标 schema */
  schema: Record<string, unknown>;
  /** 是否严格模式 */
  strict?: boolean;
}

// ── LLM 适配器接口 ───────────────────────────────────────

export interface LLMAdapter {
  /** 对话补全 */
  complete(prompt: string, options?: LLMOptions): Promise<string>;
  /** 多轮对话 */
  chat(messages: Message[], options?: LLMOptions): Promise<string>;
  /** 流式对话 */
  streamChat(messages: Message[], options?: LLMOptions): AsyncIterable<string>;
  /** 总结 */
  summarize(messages: Message[], config: SummarizeConfig): Promise<string>;
  /** 结构化提取 */
  extract(content: string, schema: Record<string, unknown>): Promise<unknown>;
}

// ── 适配器配置 ───────────────────────────────────────────

export type LLMProvider = 'openai' | 'anthropic' | 'local' | 'custom';

export interface LLMAdapterConfig {
  provider: LLMProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** 自定义适配器实现 */
  customAdapter?: LLMAdapter;
}
