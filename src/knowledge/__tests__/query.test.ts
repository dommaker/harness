/**
 * KnowledgeQuery 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { KnowledgeStore } from '../store';
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
});
