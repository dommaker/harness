/**
 * KnowledgeLifecycle 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { FileKnowledgeStore as KnowledgeStore } from '../store';
import { KnowledgeLifecycle } from '../lifecycle';
import type { KnowledgeEntry } from '../types';
import * as fs from 'fs';
import * as path from 'path';

describe('KnowledgeLifecycle', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-lifecycle');
  let store: KnowledgeStore;
  let lifecycle: KnowledgeLifecycle;

  const makeEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'DEC-001',
    type: 'decision',
    title: 'Test Decision',
    content: 'Content.',
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
    lifecycle = new KnowledgeLifecycle(store);
  });

  describe('recordReference', () => {
    it('should update lastReferenced', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001');
      const entry = store.get('DEC-001');
      expect(entry!.lastReferenced).toBeTruthy();
    });

    it('should add contributor', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'alice');
      const entry = store.get('DEC-001');
      expect(entry!.contributors).toContain('alice');
    });

    it('should not duplicate contributor', () => {
      store.save(makeEntry({ contributors: ['alice'] }));
      lifecycle.recordReference('DEC-001', 'alice');
      const entry = store.get('DEC-001');
      expect(entry!.contributors).toEqual(['alice']);
    });

    it('should return undefined for non-existent entry', () => {
      expect(lifecycle.recordReference('NON-EXISTENT')).toBeUndefined();
    });
  });

  describe('recordReference with execution result', () => {
    it('should record success execution result', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'alice', true);
      const entry = store.get('DEC-001');
      expect(entry!.executionResults).toHaveLength(1);
      expect(entry!.executionResults[0].success).toBe(true);
      expect(entry!.executionResults[0].contributor).toBe('alice');
    });

    it('should record failure execution result', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'bob', false);
      const entry = store.get('DEC-001');
      expect(entry!.executionResults).toHaveLength(1);
      expect(entry!.executionResults[0].success).toBe(false);
    });

    it('should not record execution result when success is undefined', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'alice');
      const entry = store.get('DEC-001');
      expect(entry!.executionResults).toHaveLength(0);
    });

    it('should record execution result even on same-day dedup', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'alice', true);
      lifecycle.recordReference('DEC-001', 'alice', false); // same day, but different result
      const entry = store.get('DEC-001');
      expect(entry!.referencedBy).toHaveLength(1); // deduped
      expect(entry!.executionResults).toHaveLength(2); // both recorded
    });
  });

  describe('getExecutionSuccessRate', () => {
    it('should return undefined when no execution data', () => {
      store.save(makeEntry());
      expect(lifecycle.getExecutionSuccessRate('DEC-001')).toBeUndefined();
    });

    it('should compute success rate correctly', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'a', true);
      lifecycle.recordReference('DEC-001', 'b', true);
      lifecycle.recordReference('DEC-001', 'c', false);
      const rate = lifecycle.getExecutionSuccessRate('DEC-001');
      expect(rate).toBeDefined();
      expect(rate!.total).toBe(3);
      expect(rate!.rate).toBeCloseTo(2 / 3);
    });

    it('should return undefined for non-existent entry', () => {
      expect(lifecycle.getExecutionSuccessRate('NON-EXISTENT')).toBeUndefined();
    });
  });

  describe('getHumanSuccessRate', () => {
    it('should return undefined when no execution data', () => {
      store.save(makeEntry());
      expect(lifecycle.getHumanSuccessRate('DEC-001')).toBeUndefined();
    });

    it('should return undefined when no human-sourced results', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'auto-bot', true, 'auto');
      lifecycle.recordReference('DEC-001', 'auto-bot', true, 'auto');
      expect(lifecycle.getHumanSuccessRate('DEC-001')).toBeUndefined();
    });

    it('should compute human-only success rate', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'alice', true, 'human');
      lifecycle.recordReference('DEC-001', 'bob', true, 'human');
      lifecycle.recordReference('DEC-001', 'auto-bot', true, 'auto');
      lifecycle.recordReference('DEC-001', 'charlie', false, 'human');
      const rate = lifecycle.getHumanSuccessRate('DEC-001');
      expect(rate).toBeDefined();
      expect(rate!.total).toBe(3); // 3 human results
      expect(rate!.rate).toBeCloseTo(2 / 3); // 2 success out of 3 human
    });

    it('should return undefined for non-existent entry', () => {
      expect(lifecycle.getHumanSuccessRate('NON-EXISTENT')).toBeUndefined();
    });
  });

  describe('recordReference with source', () => {
    it('should store source in execution result', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'alice', true, 'human');
      const entry = store.get('DEC-001');
      expect(entry!.executionResults[0].source).toBe('human');
    });

    it('should default source to undefined when not provided', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'alice', true);
      const entry = store.get('DEC-001');
      expect(entry!.executionResults[0].source).toBeUndefined();
    });

    it('should auto-detect source for auto- prefixed contributors', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'auto-deploy', true);
      const entry = store.get('DEC-001');
      expect(entry!.executionResults[0].source).toBe('auto');
    });
  });

  describe('onReference callback', () => {
    it('should fire callback on recordReference()', () => {
      store.save(makeEntry());
      const events: any[] = [];
      lifecycle.onReference((event) => events.push(event));

      lifecycle.recordReference('DEC-001', 'alice');

      expect(events).toHaveLength(1);
      expect(events[0].entryId).toBe('DEC-001');
      expect(events[0].contributor).toBe('alice');
      expect(events[0].timestamp).toBeDefined();
    });

    it('should fire multiple callbacks', () => {
      store.save(makeEntry());
      const events1: any[] = [];
      const events2: any[] = [];
      lifecycle.onReference((event) => events1.push(event));
      lifecycle.onReference((event) => events2.push(event));

      lifecycle.recordReference('DEC-001', 'bob');

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it('should not fire callback on same-day dedup', () => {
      store.save(makeEntry());
      const events: any[] = [];
      lifecycle.onReference((event) => events.push(event));

      lifecycle.recordReference('DEC-001', 'alice');
      lifecycle.recordReference('DEC-001', 'alice'); // same day dedup

      expect(events).toHaveLength(1); // only first call fires
    });

    it('should not fire callback for non-existent entry', () => {
      const events: any[] = [];
      lifecycle.onReference((event) => events.push(event));

      lifecycle.recordReference('NONEXISTENT', 'alice');

      expect(events).toHaveLength(0);
    });
  });

  describe('recordReference same-day dedup (B4)', () => {
    it('should skip file write when same contributor references on same day', () => {
      store.save(makeEntry());
      const result1 = lifecycle.recordReference('DEC-001', 'alice');
      expect(result1).toBeDefined();
      expect(result1!.referencedBy).toHaveLength(1);

      // Second call same day, same contributor — should return entry unchanged
      const result2 = lifecycle.recordReference('DEC-001', 'alice');
      expect(result2).toBeDefined();
      expect(result2!.referencedBy).toHaveLength(1); // no new refKey added
      expect(result2!.lastReferenced).toBe(result1!.lastReferenced); // unchanged
    });

    it('should add ref for different contributor on same day', () => {
      store.save(makeEntry());
      lifecycle.recordReference('DEC-001', 'alice');
      const result = lifecycle.recordReference('DEC-001', 'bob');
      expect(result!.referencedBy).toHaveLength(2);
    });
  });

  describe('referencedBy cap at 20 (B4)', () => {
    it('should cap referencedBy at MAX_REFERENCED_BY (20)', () => {
      // Pre-fill with 19 referencedBy entries
      const refs = Array.from({ length: 19 }, (_, i) => `user-${i}:2026-05-${String(i + 1).padStart(2, '0')}`);
      store.save(makeEntry({ referencedBy: refs }));

      // Add a new unique ref
      const result = lifecycle.recordReference('DEC-001', 'new-user');
      expect(result!.referencedBy).toHaveLength(20);
      expect(result!.referencedBy[19]).toMatch(/^new-user:/);
    });

    it('should drop oldest refs when exceeding cap', () => {
      // Pre-fill with 25 referencedBy entries
      const refs = Array.from({ length: 25 }, (_, i) => `user-${i}:2026-05-${String(i + 1).padStart(2, '0')}`);
      store.save(makeEntry({ referencedBy: refs }));

      // Add a new unique ref — total would be 26, should cap to 20
      const result = lifecycle.recordReference('DEC-001', 'brand-new');
      expect(result!.referencedBy).toHaveLength(20);
      // Should have dropped the 6 oldest (indices 0-5)
      expect(result!.referencedBy[0]).toBe('user-6:2026-05-07');
    });
  });

  describe('checkPromotion', () => {
    it('should promote draft to verified when referenced', () => {
      store.save(makeEntry({ maturity: 'draft', lastReferenced: '2026-05-01', content: 'a'.repeat(60) }));
      expect(lifecycle.checkPromotion('DEC-001')).toBe('verified');
    });

    it('should NOT promote draft with content < 50 chars', () => {
      store.save(makeEntry({ maturity: 'draft', lastReferenced: '2026-05-01', content: 'short' }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined();
    });

    it('should promote draft with exactly 50 chars content', () => {
      store.save(makeEntry({ maturity: 'draft', lastReferenced: '2026-05-01', content: 'a'.repeat(50) }));
      expect(lifecycle.checkPromotion('DEC-001')).toBe('verified');
    });

    it('should not promote unreferenced draft', () => {
      store.save(makeEntry({ maturity: 'draft', lastReferenced: '' }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined();
    });

    it('should promote verified to proven when criteria met', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        contributors: ['a', 'b', 'c'],
        projects: ['p1', 'p2'],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBe('proven');
    });

    it('should not promote verified without enough contributors', () => {
      store.save(makeEntry({
        maturity: 'verified',
        contributors: ['a'],
        projects: ['p1', 'p2'],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined();
    });

    it('should not promote verified without enough projects', () => {
      store.save(makeEntry({
        maturity: 'verified',
        contributors: ['a', 'b', 'c'],
        projects: ['p1'],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined();
    });
  });

  describe('checkEntryDecay', () => {
    it('should decay proven after 12 months', () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 13);
      store.save(makeEntry({
        maturity: 'proven',
        lastReferenced: oldDate.toISOString(),
      }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBe('verified');
    });

    it('should not decay proven within 12 months', () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 6);
      store.save(makeEntry({
        maturity: 'proven',
        lastReferenced: recentDate.toISOString(),
      }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBeUndefined();
    });

    it('should decay verified after 6 months', () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 7);
      store.save(makeEntry({
        maturity: 'verified',
        lastReferenced: oldDate.toISOString(),
      }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBe('draft');
    });

    it('should decay draft after 3 months', () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 4);
      store.save(makeEntry({
        maturity: 'draft',
        lastReferenced: oldDate.toISOString(),
      }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBe('archived');
    });
  });

  describe('runDecayCycle', () => {
    it('should apply decay to all eligible entries', () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 13);
      store.save(makeEntry({ id: 'DEC-001', maturity: 'proven', lastReferenced: oldDate.toISOString() }));
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 1);
      // DEC-002 不应 decay：lastReferenced 必须相对当前时间（硬编码日期会随时间越过阈值，2026-08 已爆雷）
      store.save(makeEntry({ id: 'DEC-002', maturity: 'draft', lastReferenced: recentDate.toISOString() }));

      const changes = lifecycle.runDecayCycle();
      expect(changes).toHaveLength(1);
      expect(changes[0].entryId).toBe('DEC-001');
      expect(changes[0].from).toBe('proven');
      expect(changes[0].to).toBe('verified');
    });
  });

  describe('tryPromote', () => {
    it('should promote eligible entry', () => {
      store.save(makeEntry({ maturity: 'draft', lastReferenced: '2026-05-01', content: 'a'.repeat(60) }));
      const change = lifecycle.tryPromote('DEC-001');
      expect(change).toBeDefined();
      expect(change!.from).toBe('draft');
      expect(change!.to).toBe('verified');

      const entry = store.get('DEC-001');
      expect(entry!.maturity).toBe('verified');
    });

    it('should return undefined for non-eligible entry', () => {
      store.save(makeEntry({ maturity: 'draft', lastReferenced: '' }));
      expect(lifecycle.tryPromote('DEC-001')).toBeUndefined();
    });

    it('should return undefined for non-existent entry', () => {
      expect(lifecycle.tryPromote('NON-EXISTENT')).toBeUndefined();
    });
  });

  describe('checkPromotion edge cases', () => {
    it('should return undefined for proven entry', () => {
      store.save(makeEntry({ maturity: 'proven', lastReferenced: '2026-05-01' }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined();
    });

    it('should return undefined for archived entry', () => {
      store.save(makeEntry({ maturity: 'archived' }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined();
    });

    it('should return undefined for non-existent entry', () => {
      expect(lifecycle.checkPromotion('NON-EXISTENT')).toBeUndefined();
    });

    // RC2: test ID exclusion
    it('should NOT promote draft with test-* ID', () => {
      store.save(makeEntry({ id: 'test-search-123', maturity: 'draft', lastReferenced: '2026-05-01', content: 'a'.repeat(60) }));
      expect(lifecycle.checkPromotion('test-search-123')).toBeUndefined();
    });

    it('should NOT promote draft with inj-test-* ID', () => {
      store.save(makeEntry({ id: 'inj-test-123', maturity: 'draft', lastReferenced: '2026-05-01', content: 'a'.repeat(60) }));
      expect(lifecycle.checkPromotion('inj-test-123')).toBeUndefined();
    });

    // RC2: verified→proven content quality gate
    it('should NOT promote verified to proven with content < 100 chars', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'short content',
        contributors: ['a', 'b', 'c'],
        projects: ['p1', 'p2'],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined();
    });

    it('should promote verified to proven with content >= 100 chars', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        contributors: ['a', 'b', 'c'],
        projects: ['p1', 'p2'],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBe('proven');
    });

    it('should NOT promote verified via Path B with content < 100 chars', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'short',
        referencedBy: ['a:2026-05-01', 'b:2026-05-02', 'c:2026-05-03'],
        sourceReferences: [
          { workflow: 'pattern:monitor', timestamp: '2026-05-01' },
          { workflow: 'pattern:triage', timestamp: '2026-05-02' },
        ],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined();
    });

    // Path C: execution success rate promotion
    it('should promote verified to proven via execution success rate >= 80%', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        executionResults: [
          { contributor: 'a', success: true, timestamp: '2026-05-01' },
          { contributor: 'b', success: true, timestamp: '2026-05-02' },
          { contributor: 'c', success: true, timestamp: '2026-05-03' },
          { contributor: 'd', success: true, timestamp: '2026-05-04' },
        ],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBe('proven'); // 4/4 = 100%
    });

    it('should promote verified to proven with exactly 80% success rate', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        executionResults: [
          { contributor: 'a', success: true, timestamp: '2026-05-01' },
          { contributor: 'b', success: true, timestamp: '2026-05-02' },
          { contributor: 'c', success: true, timestamp: '2026-05-03' },
          { contributor: 'd', success: true, timestamp: '2026-05-04' },
          { contributor: 'e', success: false, timestamp: '2026-05-05' },
        ],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBe('proven'); // 4/5 = 80%
    });

    it('should NOT promote verified with execution success rate just below 80%', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        executionResults: [
          { contributor: 'a', success: true, timestamp: '2026-05-01' },
          { contributor: 'b', success: true, timestamp: '2026-05-02' },
          { contributor: 'c', success: true, timestamp: '2026-05-03' },
          { contributor: 'd', success: false, timestamp: '2026-05-04' },
        ],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined(); // 3/4 = 75%
    });

    it('should NOT promote verified with execution success rate < 80%', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        executionResults: [
          { contributor: 'a', success: true, timestamp: '2026-05-01' },
          { contributor: 'b', success: false, timestamp: '2026-05-02' },
          { contributor: 'c', success: false, timestamp: '2026-05-03' },
        ],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined(); // 1/3 = 33%
    });

    it('should NOT promote verified with < 3 execution results', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        executionResults: [
          { contributor: 'a', success: true, timestamp: '2026-05-01' },
          { contributor: 'b', success: true, timestamp: '2026-05-02' },
        ],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined(); // only 2 results
    });

    it('should NOT promote verified via Path C with content < 100 chars', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'short',
        executionResults: [
          { contributor: 'a', success: true, timestamp: '2026-05-01' },
          { contributor: 'b', success: true, timestamp: '2026-05-02' },
          { contributor: 'c', success: true, timestamp: '2026-05-03' },
        ],
      }));
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined(); // content gate blocks
    });

    // Path C: human source preference
    it('should promote verified via human success rate when mixed with auto', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        executionResults: [
          { contributor: 'alice', success: true, timestamp: '2026-05-01', source: 'human' },
          { contributor: 'bob', success: true, timestamp: '2026-05-02', source: 'human' },
          { contributor: 'charlie', success: true, timestamp: '2026-05-03', source: 'human' },
          { contributor: 'auto-bot', success: false, timestamp: '2026-05-04', source: 'auto' },
        ],
      }));
      // Human rate: 3/3 = 100%, auto fails but human succeeds → promote
      expect(lifecycle.checkPromotion('DEC-001')).toBe('proven');
    });

    it('should NOT promote when human rate < 80% even if overall rate >= 80%', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        executionResults: [
          { contributor: 'alice', success: false, timestamp: '2026-05-01', source: 'human' },
          { contributor: 'bob', success: false, timestamp: '2026-05-02', source: 'human' },
          { contributor: 'charlie', success: true, timestamp: '2026-05-03', source: 'human' },
          { contributor: 'auto-1', success: true, timestamp: '2026-05-04', source: 'auto' },
          { contributor: 'auto-2', success: true, timestamp: '2026-05-05', source: 'auto' },
          { contributor: 'auto-3', success: true, timestamp: '2026-05-06', source: 'auto' },
        ],
      }));
      // Human rate: 1/3 = 33%, overall: 4/6 = 67% — neither meets threshold
      expect(lifecycle.checkPromotion('DEC-001')).toBeUndefined();
    });

    it('should fall back to overall rate when no human results', () => {
      store.save(makeEntry({
        maturity: 'verified',
        content: 'a'.repeat(100),
        executionResults: [
          { contributor: 'auto-1', success: true, timestamp: '2026-05-01', source: 'auto' },
          { contributor: 'auto-2', success: true, timestamp: '2026-05-02', source: 'auto' },
          { contributor: 'auto-3', success: true, timestamp: '2026-05-03', source: 'auto' },
          { contributor: 'auto-4', success: true, timestamp: '2026-05-04', source: 'auto' },
        ],
      }));
      // No human results → fall back to overall: 4/4 = 100%
      expect(lifecycle.checkPromotion('DEC-001')).toBe('proven');
    });
  });

  describe('checkEntryDecay edge cases', () => {
    it('should not decay verified within threshold', () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 3);
      store.save(makeEntry({
        maturity: 'verified',
        lastReferenced: recentDate.toISOString(),
      }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBeUndefined();
    });

    it('should return undefined for archived entry', () => {
      store.save(makeEntry({ maturity: 'archived' }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBeUndefined();
    });

    it('should return undefined for non-existent entry', () => {
      expect(lifecycle.checkEntryDecay('NON-EXISTENT')).toBeUndefined();
    });

    it('should use created date when lastReferenced is empty', () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 13);
      store.save(makeEntry({
        maturity: 'proven',
        lastReferenced: '',
        created: oldDate.toISOString(),
      }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBe('verified');
    });
  });

  // ── decayAt hard expiry ────────────────────────────────────

  describe('decayAt hard expiry', () => {
    it('should archive entry when decayAt is in the past', () => {
      store.save(makeEntry({
        maturity: 'proven',
        decayAt: '2026-01-01T00:00:00.000Z',
      }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBe('archived');
    });

    it('should NOT archive entry when decayAt is in the future', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      store.save(makeEntry({
        maturity: 'proven',
        decayAt: future.toISOString(),
        lastReferenced: new Date().toISOString(),
      }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBeUndefined();
    });

    it('should take precedence over mode-specific decay', () => {
      // proven entry with decayAt in the past should go straight to archived
      // even though proven→verified takes 12 months normally
      store.save(makeEntry({
        maturity: 'proven',
        decayAt: '2026-01-01T00:00:00.000Z',
        lastReferenced: new Date().toISOString(), // recent
      }));
      expect(lifecycle.checkEntryDecay('DEC-001')).toBe('archived');
    });
  });

  // ── rule lifecycle ─────────────────────────────────────────

  describe('rule lifecycle', () => {
    it('should promote draft→active with 1 success execution', () => {
      store.save(makeEntry({
        id: 'RULE-001',
        consumptionMode: 'rule',
        maturity: 'draft',
        content: 'API port must be 13101',
        executionResults: [
          { contributor: 'alice', success: true, timestamp: '2026-05-01T00:00:00.000Z', source: 'human' },
        ],
      }));
      expect(lifecycle.checkPromotion('RULE-001')).toBe('active');
    });

    it('should NOT promote draft→active with 0 executions', () => {
      store.save(makeEntry({
        id: 'RULE-001',
        consumptionMode: 'rule',
        maturity: 'draft',
        content: 'API port must be 13101',
        executionResults: [],
      }));
      expect(lifecycle.checkPromotion('RULE-001')).toBeUndefined();
    });

    it('should NOT promote draft→active with failure execution', () => {
      store.save(makeEntry({
        id: 'RULE-001',
        consumptionMode: 'rule',
        maturity: 'draft',
        content: 'API port must be 13101',
        executionResults: [
          { contributor: 'alice', success: false, timestamp: '2026-05-01T00:00:00.000Z', source: 'human' },
        ],
      }));
      expect(lifecycle.checkPromotion('RULE-001')).toBeUndefined();
    });

    it('should decay active→deprecated when fail rate >= 50% with 3+ results', () => {
      store.save(makeEntry({
        id: 'RULE-001',
        consumptionMode: 'rule',
        maturity: 'active',
        content: 'API port must be 13101',
        executionResults: [
          { contributor: 'alice', success: false, timestamp: '2026-05-01T00:00:00.000Z' },
          { contributor: 'bob', success: false, timestamp: '2026-05-02T00:00:00.000Z' },
          { contributor: 'charlie', success: true, timestamp: '2026-05-03T00:00:00.000Z' },
        ],
      }));
      expect(lifecycle.checkEntryDecay('RULE-001')).toBe('deprecated');
    });

    it('should NOT decay active→deprecated when fail rate < 50%', () => {
      store.save(makeEntry({
        id: 'RULE-001',
        consumptionMode: 'rule',
        maturity: 'active',
        content: 'API port must be 13101',
        executionResults: [
          { contributor: 'alice', success: true, timestamp: '2026-05-01T00:00:00.000Z' },
          { contributor: 'bob', success: true, timestamp: '2026-05-02T00:00:00.000Z' },
          { contributor: 'charlie', success: false, timestamp: '2026-05-03T00:00:00.000Z' },
        ],
      }));
      expect(lifecycle.checkEntryDecay('RULE-001')).toBeUndefined();
    });

    it('should NOT decay active with < 3 results', () => {
      store.save(makeEntry({
        id: 'RULE-001',
        consumptionMode: 'rule',
        maturity: 'active',
        content: 'API port must be 13101',
        executionResults: [
          { contributor: 'alice', success: false, timestamp: '2026-05-01T00:00:00.000Z' },
        ],
      }));
      expect(lifecycle.checkEntryDecay('RULE-001')).toBeUndefined();
    });

    it('should NOT promote or decay deprecated', () => {
      store.save(makeEntry({
        id: 'RULE-001',
        consumptionMode: 'rule',
        maturity: 'deprecated',
        content: 'Old rule',
      }));
      expect(lifecycle.checkPromotion('RULE-001')).toBeUndefined();
      expect(lifecycle.checkEntryDecay('RULE-001')).toBeUndefined();
    });
  });

  // ── context lifecycle ──────────────────────────────────────

  describe('context lifecycle', () => {
    it('should promote draft→active with 1 reference', () => {
      store.save(makeEntry({
        id: 'CTX-001',
        consumptionMode: 'context',
        maturity: 'draft',
        content: 'Project uses TypeScript 5.0',
        referencedBy: ['user:2026-05-01'],
      }));
      expect(lifecycle.checkPromotion('CTX-001')).toBe('active');
    });

    it('should NOT promote draft→active with 0 references', () => {
      store.save(makeEntry({
        id: 'CTX-001',
        consumptionMode: 'context',
        maturity: 'draft',
        content: 'Project uses TypeScript 5.0',
        referencedBy: [],
      }));
      expect(lifecycle.checkPromotion('CTX-001')).toBeUndefined();
    });

    it('should decay active→archived after 3 months unreferenced', () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 4);
      store.save(makeEntry({
        id: 'CTX-001',
        consumptionMode: 'context',
        maturity: 'active',
        content: 'Project uses TypeScript 5.0',
        lastReferenced: oldDate.toISOString(),
      }));
      expect(lifecycle.checkEntryDecay('CTX-001')).toBe('archived');
    });

    it('should NOT decay active when recently referenced', () => {
      store.save(makeEntry({
        id: 'CTX-001',
        consumptionMode: 'context',
        maturity: 'active',
        content: 'Project uses TypeScript 5.0',
        lastReferenced: new Date().toISOString(),
      }));
      expect(lifecycle.checkEntryDecay('CTX-001')).toBeUndefined();
    });

    it('should NOT promote active or archived', () => {
      store.save(makeEntry({
        id: 'CTX-001',
        consumptionMode: 'context',
        maturity: 'active',
        content: 'Project uses TypeScript 5.0',
      }));
      expect(lifecycle.checkPromotion('CTX-001')).toBeUndefined();
    });
  });

  // ── signal lifecycle ───────────────────────────────────────

  describe('signal lifecycle', () => {
    it('should NOT promote signal entries', () => {
      store.save(makeEntry({
        id: 'SIG-001',
        consumptionMode: 'signal',
        maturity: 'active',
        content: 'CPU usage spike detected',
        tags: ['monitoring'],
      }));
      expect(lifecycle.checkPromotion('SIG-001')).toBeUndefined();
    });

    it('should archive saturated signal with newer same-tag entry', () => {
      store.save(makeEntry({
        id: 'SIG-001',
        consumptionMode: 'signal',
        maturity: 'active',
        content: 'Old monitoring alert',
        tags: ['monitoring'],
        created: '2026-05-01T00:00:00.000Z',
        referencedBy: ['a:2026-05-01', 'b:2026-05-02', 'c:2026-05-03'],
      }));
      store.save(makeEntry({
        id: 'SIG-002',
        consumptionMode: 'signal',
        maturity: 'active',
        content: 'New monitoring alert',
        tags: ['monitoring'],
        created: '2026-05-10T00:00:00.000Z',
      }));
      expect(lifecycle.checkEntryDecay('SIG-001')).toBe('archived');
    });

    it('should NOT archive saturated signal without newer same-tag entry', () => {
      store.save(makeEntry({
        id: 'SIG-001',
        consumptionMode: 'signal',
        maturity: 'active',
        content: 'Latest monitoring alert',
        tags: ['monitoring'],
        created: '2026-05-10T00:00:00.000Z',
        referencedBy: ['a:2026-05-01', 'b:2026-05-02', 'c:2026-05-03'],
      }));
      expect(lifecycle.checkEntryDecay('SIG-001')).toBeUndefined();
    });

    it('should NOT archive unsaturated signal even with newer entry', () => {
      store.save(makeEntry({
        id: 'SIG-001',
        consumptionMode: 'signal',
        maturity: 'active',
        content: 'Old monitoring alert',
        tags: ['monitoring'],
        created: '2026-05-01T00:00:00.000Z',
        referencedBy: ['a:2026-05-01'], // only 1 reference, not saturated
      }));
      store.save(makeEntry({
        id: 'SIG-002',
        consumptionMode: 'signal',
        maturity: 'active',
        content: 'New monitoring alert',
        tags: ['monitoring'],
        created: '2026-05-10T00:00:00.000Z',
      }));
      expect(lifecycle.checkEntryDecay('SIG-001')).toBeUndefined();
    });
  });
});
