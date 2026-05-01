/**
 * ReferenceTracker 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { KnowledgeStore } from '../store';
import { ReferenceTracker } from '../reference-tracker';
import type { KnowledgeEntry } from '../types';
import * as fs from 'fs';
import * as path from 'path';

describe('ReferenceTracker', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-refs');
  let store: KnowledgeStore;
  let tracker: ReferenceTracker;

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
    tracker = new ReferenceTracker(store, tempDir);
  });

  describe('record', () => {
    it('should append a reference record', () => {
      tracker.record('decision-1', ['entry-1', 'entry-2']);
      const filePath = path.join(tempDir, 'references.jsonl');
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('decision-1');
      expect(content).toContain('entry-1');
    });

    it('should append multiple records', () => {
      tracker.record('decision-1', ['entry-1']);
      tracker.record('decision-2', ['entry-2']);
      const filePath = path.join(tempDir, 'references.jsonl');
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);
    });
  });

  describe('getReferencesForEntry', () => {
    it('should return decisions referencing an entry', () => {
      tracker.record('decision-1', ['entry-1', 'entry-2']);
      tracker.record('decision-2', ['entry-2', 'entry-3']);

      const refs = tracker.getReferencesForEntry('entry-2');
      expect(refs).toEqual(['decision-1', 'decision-2']);
    });

    it('should return empty array for unreferenced entry', () => {
      tracker.record('decision-1', ['entry-1']);
      expect(tracker.getReferencesForEntry('entry-999')).toEqual([]);
    });
  });

  describe('getReferencesForDecision', () => {
    it('should return entries referenced by a decision', () => {
      tracker.record('decision-1', ['entry-1', 'entry-2']);
      const entries = tracker.getReferencesForDecision('decision-1');
      expect(entries).toEqual(['entry-1', 'entry-2']);
    });

    it('should return empty array for unknown decision', () => {
      expect(tracker.getReferencesForDecision('unknown')).toEqual([]);
    });
  });

  describe('updateReferencedBy', () => {
    it('should populate referencedBy on entries', () => {
      store.save(makeEntry({ id: 'entry-1' }));
      store.save(makeEntry({ id: 'entry-2' }));

      tracker.record('decision-1', ['entry-1']);
      tracker.record('decision-2', ['entry-1', 'entry-2']);
      tracker.updateReferencedBy();

      const e1 = store.get('entry-1');
      const e2 = store.get('entry-2');
      expect(e1!.referencedBy).toContain('decision-1');
      expect(e1!.referencedBy).toContain('decision-2');
      expect(e2!.referencedBy).toEqual(['decision-2']);
    });
  });

  describe('edge cases', () => {
    it('should handle corrupt references file gracefully', () => {
      const filePath = path.join(tempDir, 'references.jsonl');
      fs.writeFileSync(filePath, 'NOT VALID JSON\n', 'utf-8');
      expect(tracker.getReferencesForEntry('any')).toEqual([]);
    });

    it('should return empty when file does not exist', () => {
      expect(tracker.getReferencesForDecision('any')).toEqual([]);
    });
  });
});
