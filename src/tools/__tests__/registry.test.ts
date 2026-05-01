/**
 * ToolRegistry 测试
 */

import { ToolRegistry } from '../registry';
import type { ToolDefinition } from '../types';

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: `tool-${Math.random().toString(36).slice(2, 6)}`,
    name: 'Test Tool',
    description: 'A test tool',
    category: 'core',
    parameters: {},
    ...overrides,
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register / get', () => {
    it('应该注册和获取工具', () => {
      const tool = makeTool({ id: 'read-file' });
      registry.register(tool);
      expect(registry.get('read-file')).toBe(tool);
    });

    it('应该批量注册', () => {
      const tools = [makeTool({ id: 'a' }), makeTool({ id: 'b' })];
      registry.registerAll(tools);
      expect(registry.size()).toBe(2);
    });

    it('应该返回 undefined 对于不存在的工具', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll / getByCategory', () => {
    it('应该获取所有工具', () => {
      registry.register(makeTool({ id: 'a', category: 'core' }));
      registry.register(makeTool({ id: 'b', category: 'std' }));
      expect(registry.getAll().length).toBe(2);
    });

    it('应该按分类过滤', () => {
      registry.register(makeTool({ id: 'a', category: 'core' }));
      registry.register(makeTool({ id: 'b', category: 'std' }));
      registry.register(makeTool({ id: 'c', category: 'core' }));

      const core = registry.getByCategory('core');
      expect(core.length).toBe(2);
      expect(core.every(t => t.category === 'core')).toBe(true);
    });
  });

  describe('search', () => {
    it('应该按名称搜索', () => {
      registry.register(makeTool({ id: 'read-file', name: 'Read File' }));
      registry.register(makeTool({ id: 'write-file', name: 'Write File' }));

      const results = registry.search('read');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('read-file');
    });

    it('应该按描述搜索', () => {
      registry.register(makeTool({ id: 'a', name: 'A', description: 'Reads file contents' }));
      registry.register(makeTool({ id: 'b', name: 'B', description: 'Writes data' }));

      const results = registry.search('contents');
      expect(results.length).toBe(1);
    });

    it('应该按 ID 搜索', () => {
      registry.register(makeTool({ id: 'git-commit', name: 'Commit' }));
      const results = registry.search('git');
      expect(results.length).toBe(1);
    });
  });

  describe('execute', () => {
    it('应该执行工具', async () => {
      registry.register(makeTool({
        id: 'echo',
        handler: async (params) => ({
          success: true,
          output: `echo: ${params.text}`,
        }),
      }));

      const result = await registry.execute('echo', { text: 'hello' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('echo: hello');
    });

    it('应该处理不存在的工具', async () => {
      const result = await registry.execute('nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('未找到');
    });

    it('应该处理未注册 handler 的工具', async () => {
      registry.register(makeTool({ id: 'no-handler' }));
      const result = await registry.execute('no-handler', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('未注册处理函数');
    });

    it('应该处理 handler 抛出异常', async () => {
      registry.register(makeTool({
        id: 'throw',
        handler: async () => { throw new Error('boom'); },
      }));

      const result = await registry.execute('throw', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('boom');
    });
  });

  describe('remove / has / size', () => {
    it('应该移除工具', () => {
      registry.register(makeTool({ id: 'temp' }));
      expect(registry.has('temp')).toBe(true);
      expect(registry.remove('temp')).toBe(true);
      expect(registry.has('temp')).toBe(false);
    });

    it('应该返回正确的 size', () => {
      expect(registry.size()).toBe(0);
      registry.register(makeTool({ id: 'a' }));
      expect(registry.size()).toBe(1);
    });
  });

  describe('toToolDefinitions', () => {
    it('应该导出为 LLM tool definitions', () => {
      registry.register(makeTool({
        id: 'read',
        name: 'Read',
        description: 'Read a file',
        parameters: { path: { type: 'string' } },
      }));

      const defs = registry.toToolDefinitions();
      expect(defs.length).toBe(1);
      expect(defs[0].name).toBe('read');
      expect(defs[0].description).toBe('Read a file');
    });
  });
});
