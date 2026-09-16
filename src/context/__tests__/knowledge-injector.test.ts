/**
 * KnowledgeInjector 测试
 */

import { KnowledgeInjector } from '../knowledge-injector';
import { KnowledgeQuery } from '../../knowledge/query';
import { FileKnowledgeStore as KnowledgeStore } from '../../knowledge/store';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('KnowledgeInjector', () => {
  let store: KnowledgeStore;
  let query: KnowledgeQuery;
  let injector: KnowledgeInjector;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'injector-test-'));
    store = new KnowledgeStore({ baseDir: path.join(tmpDir, 'knowledge') });
    query = new KnowledgeQuery(store);
    injector = new KnowledgeInjector(query);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function saveEntry(overrides: any = {}) {
    store.save({
      id: overrides.id || `test-${Math.random().toString(36).slice(2, 6)}`,
      type: 'decision',
      title: 'Test Decision',
      content: 'Some content for testing',
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
      executionResults: [],
      consumptionMode: 'reference',
      origin: 'agent',
      ...overrides,
    });
  }

  describe('inject', () => {
    it('应该返回空结果当无知识条目', () => {
      const result = injector.inject({ budget: 800 });
      expect(result.sources.length).toBe(0);
      expect(result.entriesIncluded).toBe(0);
    });

    it('应该注入知识条目为 ContextSource', () => {
      saveEntry({ id: 'dec-001', title: 'Use TypeScript', content: 'Always use TS' });
      const result = injector.inject({ budget: 8000 });
      expect(result.sources.length).toBe(1);
      expect(result.sources[0].type).toBe('knowledge');
      expect(result.sources[0].priority).toBe(3);
      expect(result.sources[0].content).toContain('Use TypeScript');
    });

    it('应该按预算裁剪', () => {
      saveEntry({ id: 'a', title: 'A', content: 'x'.repeat(5000) });
      saveEntry({ id: 'b', title: 'B', content: 'y'.repeat(5000) });
      const result = injector.inject({ budget: 500 });
      // 只能容纳部分
      expect(result.entriesIncluded).toBeLessThan(2);
    });

    it('应该降级为摘要当完整条目超出预算', () => {
      saveEntry({ id: 'big-1', title: 'Big Entry', content: 'x'.repeat(5000) });
      // 预算够查询返回条目，但不够注入完整内容
      const result = injector.inject({ budget: 1500 });
      expect(result.entriesIncluded).toBe(0);
      expect(result.entriesSummarized).toBe(1);
      expect(result.sources.some(s => s.id === 'knowledge-summary-big-1')).toBe(true);
    });

    it('应该排除已注入的条目', () => {
      saveEntry({ id: 'ex-1', title: 'Excluded' });
      const result = injector.inject({ budget: 8000, exclude: ['ex-1'] });
      expect(result.entriesExcluded).toBe(1);
      expect(result.entriesIncluded).toBe(0);
    });

    it('应该为已排除条目注入摘要', () => {
      saveEntry({ id: 'ex-2', title: 'Excluded', content: 'Some long content here' });
      const result = injector.inject({
        budget: 8000,
        exclude: ['ex-2'],
        injectSummaryForExcluded: true,
      });
      expect(result.entriesSummarized).toBe(1);
      expect(result.sources.some(s => s.id === 'knowledge-summary-ex-2')).toBe(true);
    });

    it('应该不注入摘要当配置关闭', () => {
      saveEntry({ id: 'ex-3', title: 'Excluded' });
      const result = injector.inject({
        budget: 8000,
        exclude: ['ex-3'],
        injectSummaryForExcluded: false,
      });
      expect(result.entriesSummarized).toBe(0);
    });
  });

  describe('formatEntry', () => {
    it('应该格式化完整条目', () => {
      saveEntry({ id: 'fmt-1', title: 'My Decision', type: 'decision', maturity: 'proven', tags: ['auth', 'api'] });
      const entry = store.get('fmt-1')!;
      const formatted = injector.formatEntry(entry);
      expect(formatted).toContain('[DECISION]');
      expect(formatted).toContain('My Decision');
      expect(formatted).toContain('proven');
      expect(formatted).toContain('auth, api');
    });
  });

  describe('formatEntrySummary', () => {
    it('应该生成一行摘要', () => {
      saveEntry({ id: 'sum-1', title: 'Short', content: 'Brief content' });
      const entry = store.get('sum-1')!;
      const summary = injector.formatEntrySummary(entry);
      expect(summary).toContain('[sum-1]');
      expect(summary).toContain('Short');
      expect(summary).toContain('verified');
      expect(summary.split('\n').length).toBe(1);
    });

    it('应该截断长内容', () => {
      saveEntry({ id: 'sum-2', title: 'Long', content: 'x'.repeat(200) });
      const entry = store.get('sum-2')!;
      const summary = injector.formatEntrySummary(entry);
      expect(summary).toContain('...');
      expect(summary.length).toBeLessThan(200);
    });
  });

  describe('外部内容 retrieval marking（harness#161 三层防御第二层接线）', () => {
    it('origin: external 条目注入时 prompt 带来源标记，metadata 含 origin', () => {
      saveEntry({ id: 'ext-1', title: 'External Tip', origin: 'external' });
      const result = injector.inject({ budget: 8000 });
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].content).toContain('[External Source — verify before acting]');
      expect(result.sources[0].metadata).toMatchObject({ entryId: 'ext-1', origin: 'external' });
    });

    it('非 external 条目不带来源标记，metadata 仍带 origin', () => {
      saveEntry({ id: 'int-1', title: 'Internal', origin: 'agent' });
      const result = injector.inject({ budget: 8000 });
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].content).not.toContain('[External Source — verify before acting]');
      expect(result.sources[0].metadata).toMatchObject({ origin: 'agent' });
    });

    it('external 条目的摘要注入同样带来源标记与 origin metadata', () => {
      saveEntry({ id: 'ext-2', title: 'Ext', origin: 'external' });
      const result = injector.inject({ budget: 8000, exclude: ['ext-2'] });
      const summary = result.sources.find(s => s.id === 'knowledge-summary-ext-2');
      expect(summary).toBeDefined();
      expect(summary!.content).toContain('[External Source — verify before acting]');
      expect(summary!.metadata).toMatchObject({ origin: 'external' });
    });
  });

  describe('getQuery', () => {
    it('应该返回查询引擎', () => {
      expect(injector.getQuery()).toBe(query);
    });
  });
});
