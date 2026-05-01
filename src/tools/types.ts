/**
 * 工具注册表类型定义
 */

// ── 工具定义 ─────────────────────────────────────────────

export type ToolCategory = 'core' | 'std' | 'ext';

export interface ToolDefinition {
  /** 工具唯一 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具分类 */
  category: ToolCategory;
  /** 参数 schema (JSON Schema) */
  parameters: Record<string, unknown>;
  /** 所需 sandbox 级别 */
  sandboxLevel?: 1 | 2 | 3 | 4;
  /** 是否需要确认 */
  requiresConfirmation?: boolean;
  /** 速率限制（每分钟） */
  rateLimit?: number;
  /** 工具处理函数 */
  handler?: ToolHandler;
}

export type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ── 注册表配置 ───────────────────────────────────────────

export interface ToolRegistryConfig {
  /** 自动注册核心工具 */
  autoRegisterCore?: boolean;
  /** 工具搜索路径 */
  searchPaths?: string[];
}
