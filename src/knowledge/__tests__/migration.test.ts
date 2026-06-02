/**
 * Knowledge Migration 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { migrateKnowledgeEntries } from '../migration';
import * as fs from 'fs';
import * as path from 'path';

describe('migrateKnowledgeEntries', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-migration');

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
    // Clean directory
    for (const f of fs.readdirSync(tempDir)) {
      fs.unlinkSync(path.join(tempDir, f));
    }
  });

  function writeEntry(filename: string, meta: Record<string, unknown>, content = 'Body content') {
    const frontmatter = Object.entries(meta)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join('\n');
    const raw = `---\n${frontmatter}\n---\n\n${content}`;
    fs.writeFileSync(path.join(tempDir, filename), raw, 'utf-8');
  }

  function readMeta(filename: string): Record<string, unknown> {
    const raw = fs.readFileSync(path.join(tempDir, filename), 'utf-8');
    const match = raw.match(/^---\n([\s\S]*?)\n---/)!;
    return JSON.parse(JSON.stringify(eval(`(${match[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"')})`)));
  }

  it('should add consumptionMode and origin to entries missing them', () => {
    writeEntry('DEC-001.md', {
      id: 'DEC-001', type: 'decision', title: 'Test', maturity: 'draft',
      layer: 'project', created: '2026-05-01', lastReferenced: '',
      contributors: [], projects: [], tags: [], applicablePhases: [],
      sourceReferences: [], referencedBy: [], executionResults: [],
    });

    const result = migrateKnowledgeEntries(tempDir);
    expect(result.total).toBe(1);
    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Verify the file was updated
    const raw = fs.readFileSync(path.join(tempDir, 'DEC-001.md'), 'utf-8');
    expect(raw).toContain('consumptionMode');
    expect(raw).toContain('origin');
  });

  it('should skip entries that already have both fields', () => {
    writeEntry('DEC-002.md', {
      id: 'DEC-002', type: 'decision', title: 'Test', maturity: 'draft',
      layer: 'project', created: '2026-05-01', lastReferenced: '',
      contributors: [], projects: [], tags: [], applicablePhases: [],
      sourceReferences: [], referencedBy: [], executionResults: [],
      consumptionMode: 'rule', origin: 'human',
    });

    const result = migrateKnowledgeEntries(tempDir);
    expect(result.total).toBe(1);
    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should handle empty directory', () => {
    const result = migrateKnowledgeEntries(path.join(tempDir, 'nonexistent'));
    expect(result.total).toBe(0);
    expect(result.migrated).toBe(0);
  });

  it('should handle non-markdown files gracefully', () => {
    fs.writeFileSync(path.join(tempDir, 'index.json'), '{}', 'utf-8');
    writeEntry('DEC-003.md', {
      id: 'DEC-003', type: 'decision', title: 'Test', maturity: 'draft',
      layer: 'project', created: '2026-05-01', lastReferenced: '',
      contributors: [], projects: [], tags: [], applicablePhases: [],
      sourceReferences: [], referencedBy: [], executionResults: [],
    });

    const result = migrateKnowledgeEntries(tempDir);
    expect(result.total).toBe(1); // only .md files counted
    expect(result.migrated).toBe(1);
  });

  it('should be idempotent', () => {
    writeEntry('DEC-004.md', {
      id: 'DEC-004', type: 'decision', title: 'Test', maturity: 'draft',
      layer: 'project', created: '2026-05-01', lastReferenced: '',
      contributors: [], projects: [], tags: [], applicablePhases: [],
      sourceReferences: [], referencedBy: [], executionResults: [],
    });

    const first = migrateKnowledgeEntries(tempDir);
    const second = migrateKnowledgeEntries(tempDir);
    expect(first.migrated).toBe(1);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);
  });
});
