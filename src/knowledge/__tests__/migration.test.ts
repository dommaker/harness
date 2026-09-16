/**
 * Knowledge Migration 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { migrateKnowledgeEntries } from '../migration';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('migrateKnowledgeEntries', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-migration-'));
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

  describe('知识树生成物豁免（harness#134 walker 口径单点化）', () => {
    it('_index.md 既不计入 total 也不计入 errors（修此前的假阳性）', () => {
      // 真实组合：knowledge index 把生成物落在同一个 baseDir，无 frontmatter
      fs.writeFileSync(
        path.join(tempDir, '_index.md'),
        '# Knowledge Base Index\n# Auto-generated\n\n# filename|id|type\n',
        'utf-8'
      );
      writeEntry('DEC-010.md', {
        id: 'DEC-010', type: 'decision', title: 'Test', maturity: 'draft',
        layer: 'project', created: '2026-05-01', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [], executionResults: [],
      });

      const result = migrateKnowledgeEntries(tempDir);
      expect(result.total).toBe(1);
      expect(result.errors).toEqual([]);
      expect(result.migrated).toBe(1);
      // 生成物不被改写
      expect(fs.readFileSync(path.join(tempDir, '_index.md'), 'utf-8'))
        .toContain('# Auto-generated');
    });
  });

  describe('frontmatter 收口（harness#89）', () => {
    it('缺 frontmatter：absent 是合法输入——不进 errors，按非条目语义计入 skipped（harness#161 裁决，正本 #89 裁决 2）', () => {
      fs.writeFileSync(path.join(tempDir, 'PLAIN.md'), '# 只是普通 markdown\n\n正文\n', 'utf-8');

      const result = migrateKnowledgeEntries(tempDir);
      expect(result.errors).toEqual([]);
      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(1);
    });

    it('空 meta：与缺 frontmatter 同走一支（absent），不进 errors、计 skipped', () => {
      fs.writeFileSync(path.join(tempDir, 'EMPTY-META.md'), '---\n\n---\n\nBody\n', 'utf-8');

      const result = migrateKnowledgeEntries(tempDir);
      expect(result.errors).toEqual([]);
      expect(result.skipped).toBe(1);
    });

    it('未闭合：errors 显式记 unterminated（收口前是一条 YAML 内部报错）', () => {
      fs.writeFileSync(path.join(tempDir, 'OPEN.md'), '---\nid: OPEN\ntype: decision\n', 'utf-8');

      const result = migrateKnowledgeEntries(tempDir);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/^OPEN\.md: frontmatter unterminated \(.+\)$/);
    });

    it('YAML 非法：errors 显式记 invalid-yaml 并带上可定位 detail', () => {
      fs.writeFileSync(path.join(tempDir, 'BAD.md'), '---\nid: [1,\n---\n\nBody\n', 'utf-8');

      const result = migrateKnowledgeEntries(tempDir);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/^BAD\.md: frontmatter invalid-yaml \(.+\)$/);
    });

    it('写回走正本包裹格式：首尾分隔线与空行逐字一致，二次运行字节不变（无 diff 噪声）', () => {
      writeEntry('DEC-005.md', { id: 'DEC-005', type: 'decision', title: 'T' });

      expect(migrateKnowledgeEntries(tempDir).migrated).toBe(1);
      const afterFirst = fs.readFileSync(path.join(tempDir, 'DEC-005.md'), 'utf-8');

      expect(afterFirst.startsWith('---\nid: DEC-005\n')).toBe(true);
      expect(afterFirst).toContain('---\n\nBody content');
      expect(afterFirst).toMatch(/^---\n[\s\S]*\n---\n\n/);

      expect(migrateKnowledgeEntries(tempDir).migrated).toBe(0);
      expect(fs.readFileSync(path.join(tempDir, 'DEC-005.md'), 'utf-8')).toBe(afterFirst);
    });
  });
});
