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

  describe('checkPromotion', () => {
    it('should promote draft to verified when referenced', () => {
      store.save(makeEntry({ maturity: 'draft', lastReferenced: '2026-05-01' }));
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
      store.save(makeEntry({ maturity: 'draft', lastReferenced: '2026-05-01' }));
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
