/**
 * KnowledgeStore 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { KnowledgeStore } from '../store';
import type { KnowledgeEntry } from '../types';
import * as fs from 'fs';
import * as path from 'path';

describe('KnowledgeStore', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-knowledge');
  let store: KnowledgeStore;

  const makeEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'DEC-001',
    type: 'decision',
    title: 'Test Decision',
    content: 'This is a test decision.',
    maturity: 'draft',
    layer: 'project',
    created: '2026-05-01T00:00:00.000Z',
    lastReferenced: '',
    contributors: [],
    projects: ['test-project'],
    tags: ['test'],
    applicablePhases: ['ARCHITECT'],
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
    // Clean the temp dir before each test
    const files = fs.readdirSync(tempDir);
    for (const f of files) {
      const p = path.join(tempDir, f);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
    }
    store = new KnowledgeStore({ baseDir: tempDir });
  });

  describe('save and get', () => {
    it('should save and retrieve an entry', () => {
      const entry = makeEntry();
      store.save(entry);
      const retrieved = store.get('DEC-001');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('DEC-001');
      expect(retrieved!.title).toBe('Test Decision');
      expect(retrieved!.content).toBe('This is a test decision.');
    });

    it('should return undefined for non-existent entry', () => {
      expect(store.get('NON-EXISTENT')).toBeUndefined();
    });

    it('should preserve all fields through save/load cycle', () => {
      const entry = makeEntry({
        contributors: ['alice', 'bob'],
        tags: ['arch', 'db'],
        applicablePhases: ['ANALYSE_TECH', 'ARCHITECT'],
        sourceReferences: [{ workflow: 'test-flow', step: 'step-1', timestamp: '2026-05-01' }],
      });
      store.save(entry);
      const retrieved = store.get('DEC-001');
      expect(retrieved!.contributors).toEqual(['alice', 'bob']);
      expect(retrieved!.tags).toEqual(['arch', 'db']);
      expect(retrieved!.applicablePhases).toEqual(['ANALYSE_TECH', 'ARCHITECT']);
      expect(retrieved!.sourceReferences).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('should list all entries', () => {
      store.save(makeEntry({ id: 'DEC-001' }));
      store.save(makeEntry({ id: 'DEC-002', title: 'Second' }));
      const list = store.list();
      expect(list).toHaveLength(2);
    });

    it('should filter by type', () => {
      store.save(makeEntry({ id: 'DEC-001', type: 'decision' }));
      store.save(makeEntry({ id: 'PIT-001', type: 'pitfall', title: 'Pitfall' }));
      const list = store.list({ types: ['decision'] });
      expect(list).toHaveLength(1);
      expect(list[0].type).toBe('decision');
    });

    it('should filter by maturity', () => {
      store.save(makeEntry({ id: 'DEC-001', maturity: 'draft' }));
      store.save(makeEntry({ id: 'DEC-002', maturity: 'proven', title: 'Proven' }));
      const list = store.list({ maturity: ['proven'] });
      expect(list).toHaveLength(1);
      expect(list[0].maturity).toBe('proven');
    });

    it('should exclude archived by default', () => {
      store.save(makeEntry({ id: 'DEC-001', maturity: 'draft' }));
      store.save(makeEntry({ id: 'DEC-002', maturity: 'archived', title: 'Archived' }));
      const list = store.list();
      expect(list).toHaveLength(1);
    });

    it('should include archived when excludeArchived is false', () => {
      store.save(makeEntry({ id: 'DEC-001', maturity: 'draft' }));
      store.save(makeEntry({ id: 'DEC-002', maturity: 'archived', title: 'Archived' }));
      const list = store.list({ excludeArchived: false });
      expect(list).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('should delete an entry', () => {
      store.save(makeEntry());
      expect(store.delete('DEC-001')).toBe(true);
      expect(store.get('DEC-001')).toBeUndefined();
    });

    it('should return false for non-existent entry', () => {
      expect(store.delete('NON-EXISTENT')).toBe(false);
    });
  });

  describe('update', () => {
    it('should update specific fields', () => {
      store.save(makeEntry());
      const updated = store.update('DEC-001', { title: 'Updated Title', maturity: 'verified' });
      expect(updated!.title).toBe('Updated Title');
      expect(updated!.maturity).toBe('verified');
      expect(updated!.content).toBe('This is a test decision.'); // unchanged
    });

    it('should return undefined for non-existent entry', () => {
      expect(store.update('NON-EXISTENT', { title: 'x' })).toBeUndefined();
    });
  });

  describe('rebuildIndex', () => {
    it('should rebuild index from files', () => {
      store.save(makeEntry({ id: 'DEC-001' }));
      store.save(makeEntry({ id: 'DEC-002', title: 'Second' }));
      store.rebuildIndex();
      const list = store.list();
      expect(list).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should create directory if it does not exist', () => {
      const newDir = path.join(process.cwd(), 'temp-test-knowledge-nested', 'sub', 'deep');
      const s = new KnowledgeStore({ baseDir: newDir });
      expect(fs.existsSync(newDir)).toBe(true);
      fs.rmSync(path.join(process.cwd(), 'temp-test-knowledge-nested'), { recursive: true, force: true });
    });

    it('should handle corrupt index.json gracefully', () => {
      const indexPath = path.join(tempDir, 'index.json');
      fs.writeFileSync(indexPath, 'NOT VALID JSON{{{', 'utf-8');
      // Should not throw, returns empty list
      const list = store.list();
      expect(list).toHaveLength(0);
    });

    it('should fallback to indexToEntry when file is missing', () => {
      store.save(makeEntry());
      // Delete the .md file but leave index entry
      const mdFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.md'));
      for (const f of mdFiles) {
        fs.unlinkSync(path.join(tempDir, f));
      }
      const list = store.list();
      expect(list).toHaveLength(1);
      expect(list[0].content).toBe(''); // indexToEntry returns empty content
    });

    it('should handle unreadable file gracefully', () => {
      // Write a valid entry
      store.save(makeEntry());
      // Overwrite with content that fails to parse (no frontmatter)
      const mdPath = path.join(tempDir, 'decision-DEC-001.md');
      fs.writeFileSync(mdPath, 'no frontmatter here', 'utf-8');
      const result = store.get('DEC-001');
      expect(result).toBeUndefined();
    });

    it('should filter by layer', () => {
      store.save(makeEntry({ id: 'DEC-001', layer: 'project' }));
      store.save(makeEntry({ id: 'DEC-002', layer: 'team', title: 'Team' }));
      const list = store.list({ layers: ['team'] });
      expect(list).toHaveLength(1);
      expect(list[0].layer).toBe('team');
    });

    it('should filter by tags', () => {
      store.save(makeEntry({ id: 'DEC-001', tags: ['arch', 'db'] }));
      store.save(makeEntry({ id: 'DEC-002', tags: ['perf'], title: 'Perf' }));
      const list = store.list({ tags: ['arch'] });
      expect(list).toHaveLength(1);
    });

    it('should filter by applicablePhases', () => {
      store.save(makeEntry({ id: 'DEC-001', applicablePhases: ['ARCHITECT'] }));
      store.save(makeEntry({ id: 'DEC-002', applicablePhases: ['IMPLEMENT'], title: 'Impl' }));
      const list = store.list({ applicablePhases: ['IMPLEMENT'] });
      expect(list).toHaveLength(1);
    });

    it('should save and read back decayAt field', () => {
      store.save(makeEntry({ decayAt: '2027-01-01' }));
      const retrieved = store.get('DEC-001');
      expect(retrieved!.decayAt).toBe('2027-01-01');
    });

    it('should exclude decayAt when not set', () => {
      store.save(makeEntry());
      const retrieved = store.get('DEC-001');
      expect(retrieved!.decayAt).toBeUndefined();
    });
  });
});
