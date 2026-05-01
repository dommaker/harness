/**
 * KnowledgeLifecycleHooks 测试
 */

import { KnowledgeLifecycleHooks } from '../lifecycle-hooks';
import { KnowledgeStore } from '../store';
import { KnowledgeQuery } from '../query';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('KnowledgeLifecycleHooks', () => {
  let store: KnowledgeStore;
  let query: KnowledgeQuery;
  let hooks: KnowledgeLifecycleHooks;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
    store = new KnowledgeStore({ baseDir: path.join(tmpDir, 'knowledge') });
    query = new KnowledgeQuery(store);
    hooks = new KnowledgeLifecycleHooks({ store, query });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function saveEntry(overrides: any = {}) {
    store.save({
      id: overrides.id || `test-${Math.random().toString(36).slice(2, 6)}`,
      type: 'decision',
      title: 'Test Decision',
      content: 'Some content',
      maturity: 'verified',
      layer: 'project',
      created: new Date().toISOString(),
      lastReferenced: new Date().toISOString(),
      contributors: [],
      projects: [],
      tags: [],
      applicablePhases: [],
      sourceReferences: [],
      referencedBy: [],
      ...overrides,
    });
  }

  describe('onSessionStart', () => {
    it('应该返回空数组当无知识条目', () => {
      const sources = hooks.onSessionStart();
      expect(sources.length).toBe(0);
    });

    it('应该注入知识条目为 ContextSource', () => {
      saveEntry({ id: 'dec-001', title: 'Use TypeScript', content: 'Always use TS', tags: ['typescript', 'best-practice'] });
      const sources = hooks.onSessionStart({ budget: 8000 });
      expect(sources.length).toBe(1);
      expect(sources[0].type).toBe('knowledge');
      expect(sources[0].priority).toBe(3);
      expect(sources[0].content).toContain('Use TypeScript');
      expect(sources[0].content).toContain('typescript');
    });

    it('应该排除指定条目', () => {
      saveEntry({ id: 'ex-1', title: 'Excluded' });
      const sources = hooks.onSessionStart({ budget: 8000, exclude: ['ex-1'] });
      expect(sources.length).toBe(0);
    });
  });

  describe('onTaskComplete', () => {
    it('应该从错误中提取 pitfall', () => {
      const result = hooks.onTaskComplete({
        taskDescription: 'Fix login bug',
        errors: ['TypeError: Cannot read property of undefined'],
      });

      expect(result.entries.length).toBe(1);
      expect(result.entries[0].type).toBe('pitfall');
      expect(result.entries[0].tags).toContain('auto-extract');
      expect(result.source).toBe('archive');
    });

    it('应该从决策中提取 decision', () => {
      const result = hooks.onTaskComplete({
        taskDescription: 'Choose architecture',
        decisions: ['使用微服务架构因为需要独立部署'],
      });

      expect(result.entries.length).toBe(1);
      expect(result.entries[0].type).toBe('decision');
    });

    it('应该限制提取数量', () => {
      const errors = Array.from({ length: 10 }, (_, i) => `Error ${i}`);
      const result = hooks.onTaskComplete({
        taskDescription: 'Test',
        errors,
      });

      expect(result.entries.length).toBeLessThanOrEqual(3);
    });

    it('应该处理空上下文', () => {
      const result = hooks.onTaskComplete({ taskDescription: 'Empty' });
      expect(result.entries.length).toBe(0);
    });
  });

  describe('onError', () => {
    it('应该从错误中提取知识', () => {
      const result = hooks.onError(new Error('Connection timeout'), {
        taskDescription: 'API call',
        stackTrace: 'at line 42',
      });

      expect(result.entries.length).toBe(1);
      expect(result.entries[0].type).toBe('pitfall');
      expect(result.entries[0].content).toContain('Connection timeout');
      expect(result.entries[0].content).toContain('API call');
      expect(result.source).toBe('error');
    });

    it('应该保存到知识库', () => {
      hooks.onError(new Error('Test error'));
      const entries = store.list({ excludeArchived: false });
      expect(entries.length).toBe(1);
      expect(entries[0].title).toContain('Test error');
    });

    it('应该处理无上下文的错误', () => {
      const result = hooks.onError(new Error('Simple error'));
      expect(result.entries.length).toBe(1);
    });
  });
});
