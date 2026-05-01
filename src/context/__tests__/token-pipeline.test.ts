/**
 * TokenPipeline 测试
 */

import { TokenPipeline } from '../token-pipeline';
import type { ContextSource, TokenBudgetAllocation } from '../types';

const defaultBudget: TokenBudgetAllocation = {
  total: 8000,
  systemPrompt: 1000,
  toolDefinitions: 500,
  knowledge: 600,
  notes: 300,
  history: 5600,
};

function makeSource(overrides: Partial<ContextSource> & { priority: number }): ContextSource {
  return {
    type: 'user_message',
    id: `src-${Math.random().toString(36).slice(2, 8)}`,
    content: 'test content',
    ...overrides,
  };
}

describe('TokenPipeline', () => {
  let pipeline: TokenPipeline;

  beforeEach(() => {
    pipeline = new TokenPipeline();
  });

  describe('run', () => {
    it('应该执行完整流水线', () => {
      const input = {
        sources: [
          makeSource({ type: 'system_prompt', priority: 1, content: 'You are helpful.' }),
          makeSource({ type: 'user_message', priority: 6, content: 'Hello' }),
        ],
        budget: defaultBudget,
      };

      const result = pipeline.run(input);
      expect(result.prompt).toContain('You are helpful.');
      expect(result.prompt).toContain('Hello');
      expect(result.snapshot).toBeDefined();
      expect(result.snapshot.totalTokens).toBeGreaterThan(0);
    });

    it('应该把 P1 放在开头，P6 放在结尾', () => {
      const input = {
        sources: [
          makeSource({ type: 'user_message', priority: 6, content: 'USER_MSG' }),
          makeSource({ type: 'system_prompt', priority: 1, content: 'SYSTEM' }),
          makeSource({ type: 'knowledge', priority: 3, content: 'KNOWLEDGE' }),
        ],
        budget: defaultBudget,
      };

      const result = pipeline.run(input);
      const prompt = result.prompt;
      const sysIdx = prompt.indexOf('SYSTEM');
      const knowIdx = prompt.indexOf('KNOWLEDGE');
      const userIdx = prompt.indexOf('USER_MSG');

      expect(sysIdx).toBeLessThan(knowIdx);
      expect(knowIdx).toBeLessThan(userIdx);
    });

    it('应该生成 ContextUsageSnapshot', () => {
      const input = {
        sources: [
          makeSource({ type: 'system_prompt', priority: 1, content: 'system' }),
          makeSource({ type: 'tool_output', priority: 5, content: 'output' }),
        ],
        budget: defaultBudget,
      };

      const result = pipeline.run(input);
      expect(result.snapshot.breakdown.systemPrompt).toBeGreaterThan(0);
      expect(result.snapshot.timestamp).toBeDefined();
    });
  });

  describe('collect', () => {
    it('应该按 priority 分组', () => {
      const sources = [
        makeSource({ priority: 1, content: 'a' }),
        makeSource({ priority: 3, content: 'b' }),
        makeSource({ priority: 1, content: 'c' }),
      ];

      const groups = pipeline.collect(sources);
      expect(groups.length).toBe(2);
      expect(groups[0].priority).toBe(1);
      expect(groups[0].sources.length).toBe(2);
      expect(groups[1].priority).toBe(3);
    });
  });

  describe('sort', () => {
    it('应该按 priority 排序', () => {
      const groups = [
        { priority: 1, sources: [makeSource({ priority: 1, content: 'p1' })] },
        { priority: 3, sources: [makeSource({ priority: 3, content: 'p3' })] },
      ];

      const sorted = pipeline.sort(groups);
      expect(sorted[0].priority).toBe(1);
      expect(sorted[1].priority).toBe(3);
    });
  });

  describe('compress', () => {
    it('应该不压缩 P1 和 P6', () => {
      const sorted = [
        makeSource({ type: 'system_prompt', priority: 1, content: 'a'.repeat(5000) }),
        makeSource({ type: 'user_message', priority: 6, content: 'b'.repeat(5000) }),
      ];

      const { compressed } = pipeline.compress(sorted, defaultBudget);
      expect(compressed.length).toBe(2);
    });

    it('应该裁剪超出预算的 P3-P5', () => {
      const sorted = [
        makeSource({ priority: 3, content: 'x'.repeat(10000) }),
        makeSource({ priority: 3, content: 'y'.repeat(10000) }),
      ];

      const { compressed, dropped } = pipeline.compress(sorted, defaultBudget);
      // 预算不足时，部分项被截断，部分被丢弃
      expect(compressed.length).toBeLessThanOrEqual(2);
      expect(dropped.length).toBeGreaterThan(0);
      expect(compressed.length + dropped.filter(d => d.reason.includes('超出预算')).length).toBe(2);
    });
  });

  describe('applyBudget', () => {
    it('应该按总预算裁剪', () => {
      const compressed = [
        makeSource({ priority: 5, content: 'x'.repeat(50000) }),
      ];

      const result = pipeline.applyBudget(compressed, { ...defaultBudget, total: 100 });
      // 超预算的非 P1/P6 项应被丢弃
      expect(result.length).toBeLessThanOrEqual(1);
    });

    it('应该强制保留 P1', () => {
      const compressed = [
        makeSource({ type: 'system_prompt', priority: 1, content: 'x'.repeat(50000) }),
      ];

      const result = pipeline.applyBudget(compressed, { ...defaultBudget, total: 100 });
      expect(result.length).toBe(1);
    });
  });

  describe('assemble', () => {
    it('应该按优先级拼装', () => {
      const budgeted = [
        makeSource({ priority: 6, content: 'USER' }),
        makeSource({ priority: 1, content: 'SYS' }),
        makeSource({ priority: 3, content: 'KNOW' }),
      ];

      const prompt = pipeline.assemble(budgeted);
      expect(prompt.indexOf('SYS')).toBeLessThan(prompt.indexOf('KNOW'));
      expect(prompt.indexOf('KNOW')).toBeLessThan(prompt.indexOf('USER'));
    });

    it('应该处理空输入', () => {
      const prompt = pipeline.assemble([]);
      expect(prompt).toBe('');
    });
  });
});
