/**
 * LLM Adapter 测试
 */

import { createLLMAdapter, DefaultLLMAdapter } from '../adapter';
import type { LLMAdapter, Message } from '../types';

describe('LLM Adapter', () => {
  describe('createLLMAdapter', () => {
    it('应该创建默认适配器', () => {
      const adapter = createLLMAdapter({ provider: 'openai' });
      expect(adapter).toBeInstanceOf(DefaultLLMAdapter);
    });

    it('应该使用自定义适配器', () => {
      const custom: LLMAdapter = {
        complete: async () => 'custom',
        chat: async () => 'custom',
        streamChat: async function* () { yield 'custom'; },
        summarize: async () => 'custom summary',
        extract: async () => ({}),
      };

      const adapter = createLLMAdapter({
        provider: 'custom',
        customAdapter: custom,
      });

      expect(adapter).toBe(custom);
    });
  });

  describe('DefaultLLMAdapter', () => {
    let adapter: DefaultLLMAdapter;

    beforeEach(() => {
      adapter = new DefaultLLMAdapter({ provider: 'openai', model: 'gpt-4' });
    });

    describe('complete', () => {
      it('应该抛出未实现错误', async () => {
        await expect(adapter.complete('test')).rejects.toThrow('LLM complete 未实现');
      });
    });

    describe('chat', () => {
      it('应该抛出未实现错误', async () => {
        await expect(adapter.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('LLM chat 未实现');
      });
    });

    describe('streamChat', () => {
      it('应该抛出未实现错误', async () => {
        const gen = adapter.streamChat([{ role: 'user', content: 'test' }]);
        await expect(async () => {
          for await (const _ of gen) { /* noop */ }
        }).rejects.toThrow('LLM streamChat 未实现');
      });
    });

    describe('summarize', () => {
      it('应该提取用户目标', async () => {
        const messages: Message[] = [
          { role: 'user', content: '帮我修复登录 bug' },
          { role: 'assistant', content: '好的，我来查看代码' },
          { role: 'user', content: '问题出在 token 验证' },
        ];

        const summary = await adapter.summarize(messages, {
          maxTokens: 200,
          preserve: ['user_goals'],
        });

        expect(summary).toContain('用户目标');
        expect(summary).toContain('登录 bug');
      });

      it('应该提取工具调用', async () => {
        const messages: Message[] = [
          { role: 'user', content: 'test' },
          { role: 'tool', content: 'result 1' },
          { role: 'tool', content: 'result 2' },
        ];

        const summary = await adapter.summarize(messages, {
          maxTokens: 200,
          preserve: ['tool_calls'],
        });

        expect(summary).toContain('工具调用');
        expect(summary).toContain('2');
      });

      it('应该提取错误信息', async () => {
        const messages: Message[] = [
          { role: 'user', content: 'test' },
          { role: 'assistant', content: 'Error: connection failed' },
        ];

        const summary = await adapter.summarize(messages, {
          maxTokens: 200,
          preserve: ['errors'],
        });

        expect(summary).toContain('错误');
      });

      it('应该提取决策', async () => {
        const messages: Message[] = [
          { role: 'user', content: '选择方案 A 还是方案 B？' },
          { role: 'assistant', content: '决策：使用方案 A，因为性能更好' },
        ];

        const summary = await adapter.summarize(messages, {
          maxTokens: 200,
          preserve: ['decisions'],
        });

        expect(summary).toContain('决策');
      });

      it('应该限制长度', async () => {
        const messages: Message[] = [
          { role: 'user', content: 'x'.repeat(10000) },
        ];

        const summary = await adapter.summarize(messages, {
          maxTokens: 100,
          preserve: ['user_goals'],
        });

        expect(summary.length).toBeLessThanOrEqual(400); // 100 tokens * 4 chars
      });
    });

    describe('extract', () => {
      it('应该提取结构化数据', async () => {
        const content = 'name: John\nage: 30\ncity: Beijing';
        const result = await adapter.extract(content, {
          name: 'string',
          age: 'string',
          city: 'string',
        }) as Record<string, string>;

        expect(result.name).toBe('John');
        expect(result.age).toBe('30');
        expect(result.city).toBe('Beijing');
      });

      it('应该处理缺失字段', async () => {
        const content = 'name: John';
        const result = await adapter.extract(content, {
          name: 'string',
          missing: 'string',
        }) as Record<string, string>;

        expect(result.name).toBe('John');
        expect(result.missing).toBeUndefined();
      });
    });

    describe('getters', () => {
      it('应该返回 provider', () => {
        expect(adapter.getProvider()).toBe('openai');
      });

      it('应该返回 model', () => {
        expect(adapter.getModel()).toBe('gpt-4');
      });
    });
  });
});
