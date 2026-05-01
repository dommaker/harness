/**
 * SessionCompaction 测试
 */

import { SessionCompaction } from '../compaction';
import type { SessionMessage } from '../types';

function makeMessages(count: number, contentLength: number = 100): SessionMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `message ${i} `.repeat(contentLength / 10),
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
  }));
}

describe('SessionCompaction', () => {
  describe('shouldCompact', () => {
    it('应该返回 true 当超过触发比例', () => {
      const compaction = new SessionCompaction({ triggerRatio: 0.5 });
      const messages = makeMessages(10, 500);
      // 10 * ~50 tokens each ≈ 500 tokens, budget=800 → ratio > 0.5
      expect(compaction.shouldCompact(messages, 800)).toBe(true);
    });

    it('应该返回 false 当未超过触发比例', () => {
      const compaction = new SessionCompaction({ triggerRatio: 0.9 });
      const messages = makeMessages(2, 10);
      expect(compaction.shouldCompact(messages, 10000)).toBe(false);
    });
  });

  describe('compact (eviction)', () => {
    it('应该按比例丢弃最早消息', () => {
      const compaction = new SessionCompaction({ level: 'eviction', preserveToolCallPairs: false });
      const messages = makeMessages(20, 500);
      const result = compaction.compact(messages, 1000);
      expect(result.level).toBe('eviction');
      expect(result.compacted.length).toBeLessThan(messages.length);
      expect(result.compacted.length).toBeGreaterThanOrEqual(2);
    });

    it('应该保留最近的消息', () => {
      const compaction = new SessionCompaction({ level: 'eviction', preserveToolCallPairs: false });
      const messages = makeMessages(20, 100);
      const result = compaction.compact(messages, 1000);
      const lastOriginal = messages[messages.length - 1];
      expect(result.compacted[result.compacted.length - 1]).toBe(lastOriginal);
    });

    it('应该保留 tool-call 边界对', () => {
      const compaction = new SessionCompaction({ level: 'eviction', preserveToolCallPairs: true });
      const messages: SessionMessage[] = [
        { role: 'user', content: 'a'.repeat(1000), timestamp: 't1' },
        { role: 'assistant', content: 'b'.repeat(1000), toolCallId: 'call-1', timestamp: 't2' },
        { role: 'tool', content: 'c'.repeat(1000), toolCallId: 'call-1', timestamp: 't3' },
        { role: 'user', content: 'd'.repeat(1000), timestamp: 't4' },
        { role: 'assistant', content: 'e'.repeat(1000), timestamp: 't5' },
      ];
      const result = compaction.compact(messages, 500);
      // 如果 tool result is kept, its paired assistant call should also be kept
      const toolResult = result.compacted.find(m => m.role === 'tool');
      if (toolResult) {
        const paired = result.compacted.find(m => m.toolCallId === toolResult.toolCallId && m.role === 'assistant');
        expect(paired).toBeDefined();
      }
    });
  });

  describe('compact (summary)', () => {
    it('应该生成结构化摘要', () => {
      const compaction = new SessionCompaction({ level: 'summary' });
      const messages = makeMessages(20, 100);
      const result = compaction.compact(messages, 1000);
      expect(result.level).toBe('summary');
      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('用户目标');
      expect(result.summary).toContain('消息总数');
    });

    it('应该保留最近 6 条消息', () => {
      const compaction = new SessionCompaction({ level: 'summary' });
      const messages = makeMessages(20, 100);
      const result = compaction.compact(messages, 1000);
      // 1 summary message + 6 recent
      expect(result.compacted.length).toBe(7);
    });
  });

  describe('compact (checkpoint)', () => {
    it('应该压缩为单条 checkpoint 消息', () => {
      const compaction = new SessionCompaction({ level: 'checkpoint' });
      const messages = makeMessages(20, 100);
      const result = compaction.compact(messages, 1000);
      expect(result.level).toBe('checkpoint');
      expect(result.compacted.length).toBe(1);
      expect(result.compacted[0].content).toContain('Checkpoint');
    });
  });

  describe('generateStructuredSummary', () => {
    it('应该从用户消息提取目标', () => {
      const compaction = new SessionCompaction();
      const messages: SessionMessage[] = [
        { role: 'user', content: '帮我写一个函数', timestamp: 't1' },
        { role: 'assistant', content: '好的', timestamp: 't2' },
      ];
      const summary = compaction.generateStructuredSummary(messages);
      expect(summary).toContain('帮我写一个函数');
    });

    it('应该统计工具调用', () => {
      const compaction = new SessionCompaction();
      const messages: SessionMessage[] = [
        { role: 'tool', content: 'result1', timestamp: 't1' },
        { role: 'tool', content: 'result2', timestamp: 't2' },
      ];
      const summary = compaction.generateStructuredSummary(messages);
      expect(summary).toContain('2 次');
    });
  });

  describe('getConfig', () => {
    it('应该返回配置', () => {
      const compaction = new SessionCompaction({ level: 'summary' });
      expect(compaction.getConfig().level).toBe('summary');
    });
  });

  describe('compact (default level)', () => {
    it('应该在未知 level 时回退到 eviction', () => {
      const compaction = new SessionCompaction({ level: 'eviction' as any, preserveToolCallPairs: false });
      // 直接设置一个不会匹配的 level 来触发 default 分支
      (compaction as any).config.level = 'unknown_level';
      const messages = makeMessages(20, 500);
      const result = compaction.compact(messages, 1000);
      expect(result.level).toBe('eviction');
    });
  });

  describe('preserveToolCallPairs 边界情况', () => {
    it('应该在 paired assistant 已在 compacted 中时跳过', () => {
      const compaction = new SessionCompaction({ level: 'eviction', preserveToolCallPairs: true });
      const messages: SessionMessage[] = [
        { role: 'user', content: 'a'.repeat(100), timestamp: 't1' },
        { role: 'assistant', content: 'b'.repeat(100), toolCallId: 'call-1', timestamp: 't2' },
        { role: 'tool', content: 'c'.repeat(100), toolCallId: 'call-1', timestamp: 't3' },
        { role: 'user', content: 'd'.repeat(100), timestamp: 't4' },
        { role: 'assistant', content: 'e'.repeat(100), timestamp: 't5' },
      ];
      // budget 足够大，所有消息都会保留
      const result = compaction.compact(messages, 100000);
      // paired assistant 已在 compacted 中，不应重复添加
      const assistantCalls = result.compacted.filter(m => m.toolCallId === 'call-1' && m.role === 'assistant');
      expect(assistantCalls.length).toBe(1);
    });

    it('应该处理无 toolCallId 的消息', () => {
      const compaction = new SessionCompaction({ level: 'eviction', preserveToolCallPairs: true });
      const messages: SessionMessage[] = [
        { role: 'user', content: 'a'.repeat(1000), timestamp: 't1' },
        { role: 'assistant', content: 'b'.repeat(1000), timestamp: 't2' },
        { role: 'user', content: 'c'.repeat(1000), timestamp: 't3' },
        { role: 'assistant', content: 'd'.repeat(1000), timestamp: 't4' },
      ];
      const result = compaction.compact(messages, 500);
      expect(result.compacted.length).toBeGreaterThan(0);
    });
  });
});
