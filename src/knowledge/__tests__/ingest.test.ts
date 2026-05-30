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

  describe('findDuplicate reads from disk (A1)', () => {
    it('should find duplicate even when index.json is stale', () => {
      // Create an entry normally (writes to disk + index)
      ingest.ingestEntry(
        { title: 'Disk Dedup Test', content: 'Original', type: 'decision' },
        { source: 'test', layer: 'project' },
      );

      // Corrupt index.json to simulate stale index
      const indexPath = path.join(tempDir, 'index.json');
      fs.writeFileSync(indexPath, '[]', 'utf-8');

      // Ingest same title again — should still find the duplicate on disk
      const merged = ingest.ingestEntry(
        { title: 'Disk Dedup Test', content: 'Updated', type: 'decision' },
        { source: 'test', layer: 'project' },
      );

      // Should merge into existing entry, not create a second one
      expect(merged.content).toBe('Updated');
      // Count .md files on disk (excluding index.json)
      const mdFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.md'));
      expect(mdFiles).toHaveLength(1);
    });
  });

  describe('sourceReferences cap at 20 (A2)', () => {
    it('should cap sourceReferences to MAX_SOURCE_REFS when merging', () => {
      // Create entry with 15 sourceReferences
      const refs15 = Array.from({ length: 15 }, (_, i) => ({
        workflow: `workflow-${i}`,
        timestamp: `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }));
      store.save({
        id: 'REF-001',
        type: 'decision',
        title: 'Ref Cap Test',
        content: 'Original',
        maturity: 'draft',
        layer: 'project',
        created: '2026-05-01T00:00:00.000Z',
        lastReferenced: '',
        contributors: [],
        projects: [],
        tags: [],
        applicablePhases: [],
        sourceReferences: refs15,
        referencedBy: [],
      });

      // Ingest duplicate with 10 more sourceReferences
      const refs10 = Array.from({ length: 10 }, (_, i) => ({
        workflow: `new-workflow-${i}`,
        timestamp: `2026-05-${String(i + 16).padStart(2, '0')}T00:00:00.000Z`,
      }));
      ingest.ingestEntry(
        { id: 'REF-001', title: 'Ref Cap Test', type: 'decision', sourceReferences: refs10 },
        { source: 'test', layer: 'project' },
      );

      const entry = store.get('REF-001');
      expect(entry!.sourceReferences.length).toBeLessThanOrEqual(20);
      // 15 + 10 = 25, but capped to last 20
      expect(entry!.sourceReferences).toHaveLength(20);
      // Should keep the most recent ones (slice(-20) from 25)
      expect(entry!.sourceReferences[0].workflow).toBe('workflow-5');
      expect(entry!.sourceReferences[19].workflow).toBe('new-workflow-9');
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
