/**
 * KnowledgeQuery 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { FileKnowledgeStore as KnowledgeStore } from '../store';
import { KnowledgeQuery } from '../query';
import type { KnowledgeEntry, QueryBudget } from '../types';
import * as fs from 'fs';
import * as path from 'path';

describe('KnowledgeQuery', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-query');
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
    fs.mkdirSync(tempDir, { recursive: true });
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
