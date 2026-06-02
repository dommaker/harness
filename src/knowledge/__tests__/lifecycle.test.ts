/**
 * KnowledgeLifecycle 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { KnowledgeStore } from '../store';
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
      store.save(makeEntry({ id: 'DEC-002', maturity: 'draft', lastReferenced: '2026-05-01' }));

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
});
