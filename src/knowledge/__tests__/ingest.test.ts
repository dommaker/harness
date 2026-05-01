/**
 * KnowledgeIngest 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { KnowledgeStore } from '../store';
import { KnowledgeIngest } from '../ingest';
import * as fs from 'fs';
import * as path from 'path';

describe('KnowledgeIngest', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-ingest');
  let store: KnowledgeStore;
  let ingest: KnowledgeIngest;

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
    ingest = new KnowledgeIngest(store);
  });

  describe('ingestEntry', () => {
    it('should ingest a new entry with auto-generated id', () => {
      const entry = ingest.ingestEntry(
        { title: 'Test', content: 'Content', type: 'decision' },
        { source: 'test', layer: 'project' },
      );
      expect(entry.id).toMatch(/^DEC-\d{3}$/);
      expect(entry.title).toBe('Test');
      expect(entry.maturity).toBe('draft');
    });

    it('should use provided id', () => {
      const entry = ingest.ingestEntry(
        { id: 'CUSTOM-001', title: 'Test', type: 'guideline' },
        { source: 'test', layer: 'project' },
      );
      expect(entry.id).toBe('CUSTOM-001');
    });

    it('should merge tags from options and entry', () => {
      const entry = ingest.ingestEntry(
        { title: 'Test', type: 'decision', tags: ['arch'] },
        { source: 'test', layer: 'project', tags: ['db'] },
      );
      expect(entry.tags).toContain('arch');
      expect(entry.tags).toContain('db');
    });

    it('should use maturity from options', () => {
      const entry = ingest.ingestEntry(
        { title: 'Test', type: 'decision' },
        { source: 'test', layer: 'project', maturity: 'verified' },
      );
      expect(entry.maturity).toBe('verified');
    });

    it('should merge duplicate entries', () => {
      ingest.ingestEntry(
        { title: 'Duplicate', content: 'Original', type: 'decision' },
        { source: 'test', layer: 'project' },
      );
      const merged = ingest.ingestEntry(
        { title: 'Duplicate', content: 'Updated', type: 'decision', contributors: ['alice'] },
        { source: 'test', layer: 'project' },
      );
      expect(merged.content).toBe('Updated');
      expect(merged.contributors).toContain('alice');
      // Should only have one entry in the store
      expect(store.list()).toHaveLength(1);
    });
  });

  describe('ingestBatch', () => {
    it('should ingest multiple entries', () => {
      const entries = ingest.ingestBatch(
        [
          { title: 'First', type: 'decision' },
          { title: 'Second', type: 'pitfall' },
        ],
        { source: 'test', layer: 'project' },
      );
      expect(entries).toHaveLength(2);
      expect(store.list()).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should default to guideline type when type is not provided', () => {
      const entry = ingest.ingestEntry(
        { title: 'No Type' },
        { source: 'test', layer: 'project' },
      );
      expect(entry.type).toBe('guideline');
    });

    it('should dedup case-insensitively', () => {
      ingest.ingestEntry(
        { title: 'My Decision', type: 'decision' },
        { source: 'test', layer: 'project' },
      );
      const merged = ingest.ingestEntry(
        { title: 'my decision', type: 'decision', content: 'updated' },
        { source: 'test', layer: 'project' },
      );
      expect(merged.content).toBe('updated');
      expect(store.list()).toHaveLength(1);
    });
  });
});
