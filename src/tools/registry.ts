/**
 * 工具注册表
 *
 * 工具注册/发现/执行
 */

import type { ToolDefinition, ToolCategory, ToolHandler, ToolResult } from './types';

export class ToolRegistry {
  private tools: Map<string, ToolDefinition>;

  constructor() {
    this.tools = new Map();
  }

  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  /**
   * 批量注册
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 获取工具
   */
  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  /**
   * 获取所有工具
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 按分类获取
   */
  getByCategory(category: ToolCategory): ToolDefinition[] {
    return this.getAll().filter(t => t.category === category);
  }

  /**
   * 搜索工具（名称/描述模糊匹配）
   */
  search(query: string): ToolDefinition[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(t =>
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower) ||
      t.id.toLowerCase().includes(lower),
    );
  }

  /**
   * 执行工具
   */
  async execute(id: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(id);
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `工具未找到: ${id}`,
      };
    }

    if (!tool.handler) {
      return {
        success: false,
        output: '',
        error: `工具 ${id} 未注册处理函数`,
      };
    }

    try {
      return await tool.handler(params);
    } catch (error) {
      return {
        success: false,
        output: '',
        error: `工具执行失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 移除工具
   */
  remove(id: string): boolean {
    return this.tools.delete(id);
  }

  /**
   * 工具数量
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * 检查工具是否存在
   */
  has(id: string): boolean {
    return this.tools.has(id);
  }

  /**
   * 导出为 tool definitions（用于 LLM function calling）
   */
  toToolDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.getAll().map(t => ({
      name: t.id,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}
