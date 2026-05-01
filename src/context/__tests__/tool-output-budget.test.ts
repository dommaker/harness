/**
 * ToolOutputBudget 测试
 */

import { ToolOutputBudget } from '../tool-output-budget';

describe('ToolOutputBudget', () => {
  describe('checkOutput', () => {
    it('应该允许正常输出', () => {
      const budget = new ToolOutputBudget();
      const result = budget.checkOutput('short output');
      expect(result.allowed).toBe(true);
      expect(result.strategy).toBe('full');
    });

    it('应该标记超大输出为 preview', () => {
      const budget = new ToolOutputBudget();
      const largeOutput = 'x'.repeat(20000);
      const result = budget.checkOutput(largeOutput);
      expect(result.strategy).toBe('preview');
      expect(result.reason).toContain('超过限制');
    });

    it('应该标记超大输出为 overflow 当配置开启', () => {
      const budget = new ToolOutputBudget({ overflowToDisk: true });
      const largeOutput = 'x'.repeat(20000);
      const result = budget.checkOutput(largeOutput);
      expect(result.strategy).toBe('overflow');
    });

    it('应该标记重复输出为 dedup', () => {
      const budget = new ToolOutputBudget();
      budget.checkOutput('same content');
      const result = budget.checkOutput('same content');
      expect(result.strategy).toBe('dedup');
    });

    it('应该按 token 比例检查', () => {
      const budget = new ToolOutputBudget({ maxTokenRatio: 0.1 });
      // 约 2500 tokens (10000 chars / 4)
      const output = 'x'.repeat(10000);
      const result = budget.checkOutput(output, 10000);
      expect(result.strategy).toBe('preview');
    });
  });

  describe('applyBudget', () => {
    it('应该返回完整内容当策略为 full', () => {
      const budget = new ToolOutputBudget();
      const result = budget.applyBudget('hello world', 'full');
      expect(result.content).toBe('hello world');
      expect(result.keptTokens).toBe(result.originalTokens);
    });

    it('应该生成预览当策略为 preview', () => {
      const budget = new ToolOutputBudget({ previewLines: 3 });
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i} with some extra content to make it longer`);
      const result = budget.applyBudget(lines.join('\n'), 'preview');
      expect(result.content).toContain('line 0');
      expect(result.content).toContain('省略');
      expect(result.keptTokens).toBeLessThan(result.originalTokens);
    });

    it('应该返回省略提示当策略为 dedup', () => {
      const budget = new ToolOutputBudget();
      const result = budget.applyBudget('duplicate content', 'dedup');
      expect(result.content).toContain('重复内容');
    });

    it('应该处理 overflow 策略', () => {
      const budget = new ToolOutputBudget({ previewLines: 2 });
      const content = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
      const result = budget.applyBudget(content, 'overflow');
      expect(result.content).toContain('输出已写入磁盘');
      expect(result.offloaded).toBeDefined();
    });
  });

  describe('clearDedupCache', () => {
    it('应该清除去重缓存', () => {
      const budget = new ToolOutputBudget();
      budget.checkOutput('content');
      budget.clearDedupCache();
      const result = budget.checkOutput('content');
      expect(result.strategy).toBe('full');
    });
  });

  describe('getConfig', () => {
    it('应该返回配置', () => {
      const budget = new ToolOutputBudget({ maxChars: 8000 });
      expect(budget.getConfig().maxChars).toBe(8000);
    });
  });
});
