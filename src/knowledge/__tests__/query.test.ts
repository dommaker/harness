/**
 * KnowledgeQuery 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { FileKnowledgeStore as KnowledgeStore } from '../store';
import { KnowledgeQuery } from '../query';
import { KnowledgeLifecycle } from '../lifecycle';
import type { KnowledgeEntry, QueryBudget } from '../types';
import { estimateTokens } from '../token-estimate';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// D7 IO 计数：包装真实 fs（照 audit-write-count 手法），只数知识条目 .md 的 readFileSync。
// fs 属性不可 spyOn，工厂内不引闭包外变量，计数挂 globalThis。
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  const g = globalThis as unknown as { __D7_MD_READS__?: string[] };
  if (!g.__D7_MD_READS__) g.__D7_MD_READS__ = [];
  const bucket = g.__D7_MD_READS__;
  const name = (p: unknown): string => (Buffer.isBuffer(p) ? p.toString('utf8') : String(p));
  return {
    ...actual,
    readFileSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      const file = name(p);
      if (file.endsWith('.md')) bucket.push(file);
      return (actual.readFileSync as (...args: unknown[]) => unknown)(p, ...rest);
    }),
  };
});

const mdReads = (): string[] =>
  ((globalThis as unknown as { __D7_MD_READS__?: string[] }).__D7_MD_READS__ ||= []);

describe('KnowledgeQuery', () => {
  let tempDir: string;
  let store: KnowledgeStore;
  let query: KnowledgeQuery;

  const makeEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'DEC-001',
    type: 'decision',
    title: 'Test Decision',
    content: 'Short content.',
    maturity: 'draft',
    layer: 'project',
    created: '2026-05-01T00:00:00.000Z',
    lastReferenced: '',
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

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-query-'));
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    const files = fs.readdirSync(tempDir);
    for (const f of files) {
      fs.unlinkSync(path.join(tempDir, f));
    }
    store = new KnowledgeStore({ baseDir: tempDir });
    query = new KnowledgeQuery(store);
  });

  describe('query', () => {
    it('should return entries matching focus types', () => {
      store.save(makeEntry({ id: 'DEC-001', type: 'decision' }));
      store.save(makeEntry({ id: 'PIT-001', type: 'pitfall', title: 'Pitfall' }));

      const budget: QueryBudget = {
        phase: 'ARCHITECT',
        maxTokens: 10000,
        maxEntries: 10,
        focusTypes: ['decision'],
      };

      const result = query.query(budget);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe('decision');
    });

    it('should sort by maturity descending', () => {
      store.save(makeEntry({ id: 'DEC-001', maturity: 'draft' }));
      store.save(makeEntry({ id: 'DEC-002', maturity: 'proven', title: 'Proven' }));
      store.save(makeEntry({ id: 'DEC-003', maturity: 'verified', title: 'Verified' }));

      const budget: QueryBudget = {
        phase: 'test',
        maxTokens: 100000,
        maxEntries: 10,
        focusTypes: ['decision'],
      };

      const result = query.query(budget);
      expect(result.entries[0].maturity).toBe('proven');
      expect(result.entries[1].maturity).toBe('verified');
      expect(result.entries[2].maturity).toBe('draft');
    });

    it('should respect maxEntries budget', () => {
      for (let i = 1; i <= 5; i++) {
        store.save(makeEntry({ id: `DEC-${String(i).padStart(3, '0')}`, title: `D${i}` }));
      }

      const budget: QueryBudget = {
        phase: 'test',
        maxTokens: 100000,
        maxEntries: 2,
        focusTypes: ['decision'],
      };

      const result = query.query(budget);
      expect(result.entries).toHaveLength(2);
      expect(result.truncated).toBe(true);
    });

    it('should respect maxTokens budget', () => {
      store.save(makeEntry({
        id: 'DEC-001',
        content: 'A'.repeat(1000), // ~250 tokens
      }));
      store.save(makeEntry({
        id: 'DEC-002',
        content: 'B'.repeat(1000),
        title: 'Second',
      }));

      const budget: QueryBudget = {
        phase: 'test',
        maxTokens: 300, // only room for one entry
        maxEntries: 10,
        focusTypes: ['decision'],
      };

      const result = query.query(budget);
      expect(result.entries).toHaveLength(1);
      expect(result.truncated).toBe(true);
    });

    it('should cache results within TTL', () => {
      store.save(makeEntry());

      const budget: QueryBudget = {
        phase: 'test',
        maxTokens: 10000,
        maxEntries: 10,
        focusTypes: ['decision'],
      };

      const first = query.query(budget);
      expect(first.fromCache).toBe(false);

      const second = query.query(budget);
      expect(second.fromCache).toBe(true);
    });
  });

  describe('引用记账批量化（P1.3）', () => {
    const budget = (): QueryBudget => ({
      phase: 'test',
      maxTokens: 100000,
      maxEntries: 10,
      focusTypes: ['decision'],
    });

    /**
     * 接缝级闸：引用记账必须走 store 批量原语 applyAll 一次、
     * 不得逐条 update（update = get→save→全量重写 index.json）。
     * applyAll 内部「一次落盘」由 store/lifecycle 侧测试钉（同 harness#134 口径）。
     */
    const spyWritePath = () => {
      const updateSpy = jest.spyOn(store, 'update');
      const applyAllSpy = jest.spyOn(store, 'applyAll');
      return {
        updateSpy,
        applyAllSpy,
        restore: () => { updateSpy.mockRestore(); applyAllSpy.mockRestore(); },
        assertSingleBatch: () => {
          expect(updateSpy).not.toHaveBeenCalled();
          expect(applyAllSpy).toHaveBeenCalledTimes(1);
        },
        /** 去重/空结果闸：不允许任何带真更新的批次 */
        assertNoRealBatch: () => {
          expect(updateSpy).not.toHaveBeenCalled();
          expect(applyAllSpy.mock.calls.every(args => (args[0] as unknown[]).length === 0)).toBe(true);
        },
      };
    };

    it('N 条结果一次 query 只走一次批量落盘', () => {
      for (let i = 1; i <= 4; i++) {
        store.save(makeEntry({ id: `DEC-${String(i).padStart(3, '0')}`, title: `D${i}` }));
      }

      const { restore, assertSingleBatch } = spyWritePath();
      try {
        const result = query.query(budget());
        expect(result.entries).toHaveLength(4); // 正对照：真返回 4 条，「1 次批量」不是空跑出来的
        assertSingleBatch();
      } finally {
        restore();
      }
    });

    it('每条结果都记账并持久化（lastReferenced + referencedBy）', () => {
      for (let i = 1; i <= 3; i++) {
        store.save(makeEntry({ id: `DEC-${String(i).padStart(3, '0')}`, title: `D${i}` }));
      }

      query.query(budget());

      for (let i = 1; i <= 3; i++) {
        const entry = store.get(`DEC-${String(i).padStart(3, '0')}`)!;
        expect(entry.lastReferenced).not.toBe('');
        expect(entry.referencedBy).toHaveLength(1);
        expect(entry.referencedBy[0]).toMatch(/^unknown:/);
      }
    });

    it('空结果不产生任何引用写入', () => {
      store.save(makeEntry({ id: 'PIT-001', type: 'pitfall' })); // focusTypes 过滤后不命中

      const updateSpy = jest.spyOn(store, 'update');
      const applyAllSpy = jest.spyOn(store, 'applyAll');
      try {
        const result = query.query(budget());
        expect(result.entries).toHaveLength(0);
        expect(updateSpy).not.toHaveBeenCalled();
        // 允许一次空批 applyAll（契约即零读写），但不允许带真更新的批次
        expect(applyAllSpy.mock.calls.every(args => (args[0] as unknown[]).length === 0)).toBe(true);
      } finally {
        updateSpy.mockRestore();
        applyAllSpy.mockRestore();
      }
    });

    it('同日重复 query（clearCache 后）去重：零写入、回调不重复触发', () => {
      store.save(makeEntry());
      const lifecycle = new KnowledgeLifecycle(store);
      const events: string[] = [];
      lifecycle.onReference(e => events.push(e.entryId));
      query = new KnowledgeQuery(store, lifecycle);

      query.query(budget());
      expect(events).toEqual(['DEC-001']);

      query.clearCache(); // 绕过缓存命中，让引用记账真实再跑一次
      const { restore, assertNoRealBatch } = spyWritePath();
      try {
        const result = query.query(budget());
        expect(result.entries).toHaveLength(1); // 正对照
        // 同日去重：引用键已存在 → 空批，不触发任何写入
        assertNoRealBatch();
      } finally {
        restore();
      }
      expect(events).toEqual(['DEC-001']);
    });

    it('引用驱动成熟度阶梯：被引用的草稿条目满足晋升条件', () => {
      store.save(makeEntry({ id: 'DEC-001', content: 'x'.repeat(60), maturity: 'draft' }));

      query.query(budget());

      expect(new KnowledgeLifecycle(store).checkPromotion('DEC-001')).toBe('verified');
    });

    it('查询副作用仍 fail-open：记账抛错不影响查询结果返回', () => {
      store.save(makeEntry({ id: 'DEC-001', maturity: 'draft' }));
      // 让落盘在引用记账阶段必炸：条目文件在场但 maturity 枚举被外部改脏，
      // applyAll 整批预校验拒写
      const filePath = path.join(tempDir, 'decision-DEC-001.md');
      fs.writeFileSync(filePath, fs.readFileSync(filePath, 'utf-8').replace('maturity: draft', 'maturity: bogus'));

      const result = query.query(budget());
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe('DEC-001');
    });
  });

  describe('按需物化（D7）：过滤与截断的条目全文零读取', () => {
    // 夹具纪律（回修）：每轮独立 mkdtemp + afterEach 清理，内层 let 遮蔽外层共享夹具
    let tempDir: string;
    let store: KnowledgeStore;
    let query: KnowledgeQuery;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd7-query-mat-'));
      store = new KnowledgeStore({ baseDir: tempDir });
      query = new KnowledgeQuery(store);
      mdReads().length = 0;
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const budget = (overrides?: Partial<QueryBudget>): QueryBudget => ({
      phase: 'test',
      maxTokens: 100000,
      maxEntries: 10,
      focusTypes: ['decision'],
      ...overrides,
    });

    it('被 focusTypes 过滤的条目全文零读取', () => {
      store.save(makeEntry({ id: 'DEC-001', type: 'decision' }));
      store.save(makeEntry({ id: 'PIT-001', type: 'pitfall', title: 'Pitfall' }));

      mdReads().length = 0;
      const result = query.query(budget());
      expect(result.entries.map(e => e.id)).toEqual(['DEC-001']);
      expect(mdReads()).not.toContain(path.join(tempDir, 'pitfall-PIT-001.md'));
    });

    it('maxEntries 截断的溢出候选全文零读取', () => {
      for (let i = 1; i <= 5; i++) {
        store.save(makeEntry({ id: `DEC-${String(i).padStart(3, '0')}`, title: `D${i}` }));
      }

      mdReads().length = 0;
      const result = query.query(budget({ maxEntries: 2 }));
      expect(result.entries).toHaveLength(2);
      expect(result.truncated).toBe(true);
      for (let i = 3; i <= 5; i++) {
        expect(mdReads()).not.toContain(path.join(tempDir, `decision-DEC-00${i}.md`));
      }
    });

    it('maxTokens 截断的溢出候选全文零读取', () => {
      store.save(makeEntry({ id: 'DEC-001', content: 'A'.repeat(1000) })); // ~250 tokens
      store.save(makeEntry({ id: 'DEC-002', content: 'B'.repeat(1000), title: 'Second' }));

      mdReads().length = 0;
      const result = query.query(budget({ maxTokens: 300 }));
      expect(result.entries.map(e => e.id)).toEqual(['DEC-001']);
      expect(result.truncated).toBe(true);
      expect(mdReads()).not.toContain(path.join(tempDir, 'decision-DEC-002.md'));
    });

    it('过滤后零命中：全文零读取', () => {
      store.save(makeEntry({ id: 'PIT-001', type: 'pitfall', title: 'Pitfall' }));

      mdReads().length = 0;
      const result = query.query(budget());
      expect(result.entries).toHaveLength(0);
      expect(mdReads()).toHaveLength(0);
    });

    it('query 全程每条结果只读一次全文：物化 + 引用记账 + applyAll 零重复读取', () => {
      for (let i = 1; i <= 4; i++) {
        store.save(makeEntry({ id: `DEC-${String(i).padStart(3, '0')}`, title: `D${i}` }));
      }

      mdReads().length = 0;
      const result = query.query(budget({ maxEntries: 2 }));
      expect(result.entries).toHaveLength(2); // 正对照：真返回 2 条，「只读一次」不是空跑出来的
      expect(mdReads().sort()).toEqual([
        path.join(tempDir, 'decision-DEC-001.md'),
        path.join(tempDir, 'decision-DEC-002.md'),
      ]);
    });

    it('search 命中仅正文含关键词、被普通 query 排序/预算排除的条目（且无引用副作用）', () => {
      // proven 高排名 + 巨大正文占满 budget；目标条目 draft、零引用、关键词只在正文
      store.save(makeEntry({
        id: 'BIG-001', title: 'Filler', content: '填'.repeat(2000),
        maturity: 'proven', lastReferenced: '2026-08-01',
      }));
      store.save(makeEntry({
        id: 'TGT-001', title: '边缘条目', content: '正文里藏着 needle-keyword 的说明',
        maturity: 'draft', lastReferenced: '',
      }));

      const qResult = query.query(budget({ maxTokens: 500, maxEntries: 1 }));
      expect(qResult.entries.map(e => e.id)).not.toContain('TGT-001'); // 普通 query 排除
      expect(qResult.truncated).toBe(true);

      const found = query.search('needle-keyword');
      expect(found.map(e => e.id)).toEqual(['TGT-001']); // search 先匹配全语料再排序/limit
      expect(store.get('TGT-001')!.referencedBy).toHaveLength(0); // searching is not citing
    });

    it('旧索引（无 tokenCount）走兼容路径：过滤/排序/截断/tokensUsed 与新索引一致', () => {
      store.save(makeEntry({ id: 'DEC-001', title: 'A', maturity: 'draft', content: 'x'.repeat(60) }));
      store.save(makeEntry({ id: 'DEC-002', title: 'B', maturity: 'proven', content: 'y'.repeat(1000) }));
      store.save(makeEntry({ id: 'DEC-003', title: 'C', maturity: 'draft', content: 'z'.repeat(60), lastReferenced: '2026-06-01' }));

      // 新索引基线（DEC-003 lastReferenced 晚于 DEC-001，同成熟度下排前）
      const fresh = query.query(budget({ maxEntries: 2 }));
      expect(fresh.entries.map(e => e.id)).toEqual(['DEC-002', 'DEC-003']);
      expect(fresh.truncated).toBe(true);

      // 剥成旧格式（外部旧库现场）
      const indexPath = path.join(tempDir, 'index.json');
      const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      fs.writeFileSync(indexPath, JSON.stringify(raw.map((e: Record<string, unknown>) => {
        const rest = { ...e };
        delete rest.tokenCount;
        return rest;
      }), null, 2), 'utf-8');

      const fallback = query.query(budget({ maxEntries: 2 }));
      expect(fallback.entries.map(e => e.id)).toEqual(fresh.entries.map(e => e.id));
      expect(fallback.truncated).toBe(fresh.truncated);
      expect(fallback.tokensUsed).toBe(fresh.tokensUsed);
      expect(fallback.tokensUsed).toBe(
        estimateTokens('y'.repeat(1000)) + estimateTokens('B') +
        estimateTokens('x'.repeat(60)) + estimateTokens('A'),
      );
    });
  });

  describe('estimateTokens', () => {
    it('should estimate CJK characters at ~2 tokens', () => {
      const tokens = query.estimateTokens('你好世界'); // 4 CJK chars
      expect(tokens).toBe(8);
    });

    it('should estimate ASCII characters at ~0.25 tokens', () => {
      const tokens = query.estimateTokens('hello'); // 5 ASCII chars
      expect(tokens).toBe(2); // ceil(1.25)
    });

    it('should handle mixed content', () => {
      const tokens = query.estimateTokens('hello你好');
      // 5 ASCII * 0.25 = 1.25, 2 CJK * 2 = 4, total = 5.25, ceil = 6
      expect(tokens).toBe(6);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', () => {
      store.save(makeEntry());

      const budget: QueryBudget = {
        phase: 'test',
        maxTokens: 10000,
        maxEntries: 10,
        focusTypes: ['decision'],
      };

      query.query(budget);
      query.clearCache();

      const result = query.query(budget);
      expect(result.fromCache).toBe(false);
    });
  });

  describe('queryByMode', () => {
    it('should filter by consumptionMode', () => {
      store.save(makeEntry({ id: 'RUL-001', consumptionMode: 'rule', title: 'Rule' }));
      store.save(makeEntry({ id: 'REF-001', consumptionMode: 'reference', title: 'Ref' }));
      store.save(makeEntry({ id: 'SIG-001', consumptionMode: 'signal', title: 'Signal' }));

      const rules = query.queryByMode('rule');
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('RUL-001');
    });

    it('should combine with additional filter', () => {
      store.save(makeEntry({ id: 'REF-001', consumptionMode: 'reference', tags: ['arch'] }));
      store.save(makeEntry({ id: 'REF-002', consumptionMode: 'reference', tags: ['api'] }));

      const refs = query.queryByMode('reference', { tags: ['arch'] });
      expect(refs).toHaveLength(1);
      expect(refs[0].id).toBe('REF-001');
    });
  });

  describe('consume', () => {
    it('should return rules, references, and context', () => {
      store.save(makeEntry({ id: 'RUL-001', consumptionMode: 'rule', title: 'Port Rule' }));
      store.save(makeEntry({
        id: 'REF-001', consumptionMode: 'reference', title: 'Architecture',
        content: 'The API uses TypeScript and REST endpoints',
      }));
      store.save(makeEntry({
        id: 'CTX-001', consumptionMode: 'context', title: 'Env',
        applicablePhases: ['build'],
      }));

      const result = query.consume({ requirementText: 'API TypeScript', phase: 'build' });
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0].id).toBe('RUL-001');
      expect(result.references.length).toBeGreaterThanOrEqual(1);
      expect(result.context).toHaveLength(1);
      expect(result.context[0].id).toBe('CTX-001');
    });

    it('should filter context by phase', () => {
      store.save(makeEntry({
        id: 'CTX-001', consumptionMode: 'context', title: 'Build Config',
        applicablePhases: ['build'],
      }));
      store.save(makeEntry({
        id: 'CTX-002', consumptionMode: 'context', title: 'Deploy Config',
        applicablePhases: ['deploy'],
      }));

      const result = query.consume({ phase: 'build' });
      expect(result.context).toHaveLength(1);
      expect(result.context[0].id).toBe('CTX-001');
    });

    it('should return empty references when no requirementText', () => {
      store.save(makeEntry({ id: 'REF-001', consumptionMode: 'reference' }));
      const result = query.consume({});
      // With no text filter, returns up to 3
      expect(result.references.length).toBeLessThanOrEqual(3);
    });
  });

  describe('formatForPrompt', () => {
    it('should add External Source prefix for external origin', () => {
      const { KnowledgeQuery: KQ } = require('../query');
      const entry = makeEntry({ origin: 'external', title: 'GitHub Doc', content: 'Architecture' });
      const result = KQ.formatForPrompt(entry);
      expect(result).toContain('[External Source');
      expect(result).toContain('GitHub Doc');
      expect(result).toContain('Architecture');
    });

    it('should not add prefix for agent origin', () => {
      const { KnowledgeQuery: KQ } = require('../query');
      const entry = makeEntry({ origin: 'agent', title: 'Internal', content: 'Details' });
      const result = KQ.formatForPrompt(entry);
      expect(result).not.toContain('[External Source');
      expect(result).toBe('Internal: Details');
    });
  });

  describe('search', () => {
    it('should match against title, content and tags (case-insensitive)', () => {
      store.save(makeEntry({ id: 'DEC-001', title: 'Autolink Design' }));
      store.save(makeEntry({ id: 'DEC-002', title: 'Other', content: 'mentions AUTOLINK here' }));
      store.save(makeEntry({ id: 'DEC-003', title: 'Tagged', tags: ['autolink'] }));
      store.save(makeEntry({ id: 'DEC-004', title: 'Unrelated', content: 'nothing' }));

      const result = query.search('autolink');
      expect(result.map(e => e.id).sort()).toEqual(['DEC-001', 'DEC-002', 'DEC-003']);
    });

    it('should match on the full corpus regardless of token volume (harness#63)', () => {
      // 语料总 token 远超任何 prompt budget；排序队尾的 draft 新条目必须可搜到
      for (let i = 0; i < 25; i++) {
        store.save(makeEntry({
          id: `FILL-${String(i).padStart(3, '0')}`,
          title: `填充 ${i}`,
          content: '填'.repeat(399),
          maturity: 'proven',
          lastReferenced: '2026-08-01T00:00:00.000Z',
        }));
      }
      store.save(makeEntry({ id: 'PIT-020', title: '新条目', content: 'autolink 要点' }));

      const result = query.search('autolink', { limit: 200 });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('PIT-020');
    });

    it('should apply limit after matching, not before', () => {
      for (let i = 0; i < 10; i++) {
        store.save(makeEntry({ id: `DEC-${String(i).padStart(3, '0')}`, title: `共同词 ${i}` }));
      }

      expect(query.search('共同词', { limit: 3 })).toHaveLength(3);
      expect(query.search('共同词', { limit: 50 })).toHaveLength(10);
    });

    it('should sort matches by maturity desc then lastReferenced desc', () => {
      store.save(makeEntry({ id: 'DEC-001', title: 'kw a', maturity: 'draft' }));
      store.save(makeEntry({ id: 'DEC-002', title: 'kw b', maturity: 'proven', lastReferenced: '2026-01-01' }));
      store.save(makeEntry({ id: 'DEC-003', title: 'kw c', maturity: 'proven', lastReferenced: '2026-08-01' }));

      const result = query.search('kw');
      expect(result.map(e => e.id)).toEqual(['DEC-003', 'DEC-002', 'DEC-001']);
    });

    it('should exclude archived entries by default and respect filter overrides', () => {
      store.save(makeEntry({ id: 'DEC-001', title: 'kw active' }));
      store.save(makeEntry({ id: 'DEC-002', title: 'kw archived', maturity: 'archived' }));

      expect(query.search('kw').map(e => e.id)).toEqual(['DEC-001']);
      expect(query.search('kw', { filter: { excludeArchived: false } })).toHaveLength(2);
    });

    it('should respect filter.types', () => {
      store.save(makeEntry({ id: 'DEC-001', type: 'decision', title: 'kw' }));
      store.save(makeEntry({ id: 'PIT-001', type: 'pitfall', title: 'kw' }));

      const result = query.search('kw', { filter: { types: ['pitfall'] } });
      expect(result.map(e => e.id)).toEqual(['PIT-001']);
    });
  });
});
