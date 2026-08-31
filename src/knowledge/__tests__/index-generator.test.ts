/**
 * KnowledgeIndexGenerator tests
 *
 * Covers:
 * - Frontmatter extraction (id, type, title, maturity, tags)
 * - Files without frontmatter (best-effort from filename/H1)
 * - Excluded directories (.archive, .snapshots, resolutions)
 * - H2 heading extraction as search terms
 * - Index file format (header + data lines)
 * - Overwrite behavior
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KnowledgeIndexGenerator } from '../index-generator';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'idx-gen-test-'));
}

function writeEntry(dir: string, filename: string, frontmatter: Record<string, unknown> | null, body: string = 'Content here'): void {
  const lines: string[] = [];
  if (frontmatter) {
    lines.push('---');
    for (const [k, v] of Object.entries(frontmatter)) {
      if (Array.isArray(v)) {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${item}`);
      } else {
        lines.push(`${k}: ${JSON.stringify(v)}`);
      }
    }
    lines.push('---');
    lines.push('');
  }
  lines.push(body);
  fs.writeFileSync(path.join(dir, filename), lines.join('\n'));
}

describe('KnowledgeIndexGenerator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateIndexLines', () => {
    it('extracts metadata from frontmatter', () => {
      writeEntry(tmpDir, 'architecture-ARC-011.md', {
        id: 'ARC-011',
        type: 'architecture',
        title: 'JWT认证系统',
        maturity: 'verified',
        tags: ['jwt', 'auth'],
      });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      const fields = lines[0].split('|');
      expect(fields[0]).toBe('architecture-ARC-011.md');
      expect(fields[1]).toBe('ARC-011');
      expect(fields[2]).toBe('architecture');
      expect(fields[3]).toBe('JWT认证系统');
      expect(fields[4]).toBe('verified');
      expect(fields[5]).toBe('jwt;auth');
    });

    it('includes H2 headings as search terms', () => {
      writeEntry(tmpDir, 'pitfall-001.md', {
        id: 'PIT-001',
        type: 'pitfall',
        title: 'Test Pitfall',
        maturity: 'verified',
        tags: [],
      }, `# Title

## 问题根因
Some text

## 修复方案
More text

## 注意事项
Extra text
`);

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();
      const terms = lines[0].split('|')[6];

      expect(terms).toContain('问题根因');
      expect(terms).toContain('修复方案');
      expect(terms).toContain('注意事项');
    });

    it('handles files without frontmatter via best-effort', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'agent-network-core-concepts.md'),
        '# 核心概念总览\n\n## 设计要点\nBody\n'
      );

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      const fields = lines[0].split('|');
      expect(fields[0]).toBe('agent-network-core-concepts.md');
      // agent-network-* prefix maps to architecture
      expect(fields[2]).toBe('architecture');
      // H2 terms should still be extracted
      expect(fields[6]).toContain('设计要点');
    });

    it('excludes .archive directory', () => {
      fs.mkdirSync(path.join(tmpDir, '.archive'));
      writeEntry(tmpDir, 'top.md', { id: 'T1', type: 'pitfall', title: 'Top', maturity: 'verified', tags: [] });
      writeEntry(tmpDir, '.archive/archived.md', { id: 'A1', type: 'pitfall', title: 'Archived', maturity: 'archived', tags: [] });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('top.md');
      expect(lines.join('')).not.toContain('archived.md');
    });

    it('excludes resolutions directory', () => {
      fs.mkdirSync(path.join(tmpDir, 'resolutions'));
      writeEntry(tmpDir, 'top.md', { id: 'T1', type: 'pitfall', title: 'Top', maturity: 'verified', tags: [] });
      writeEntry(tmpDir, 'resolutions/res-001.md', { id: 'R1', type: 'decision', title: 'Res', maturity: 'verified', tags: [] });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      expect(lines.join('')).not.toContain('res-001.md');
    });

    it('excludes .snapshots directory', () => {
      fs.mkdirSync(path.join(tmpDir, '.snapshots'));
      writeEntry(tmpDir, 'top.md', { id: 'T1', type: 'pitfall', title: 'Top', maturity: 'verified', tags: [] });
      writeEntry(tmpDir, '.snapshots/snap.md', { id: 'S1', type: 'pitfall', title: 'Snap', maturity: 'verified', tags: [] });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      expect(lines.join('')).not.toContain('snap.md');
    });

    it('excludes _index.md from index', () => {
      writeEntry(tmpDir, '_index.md', { id: 'IDX', type: 'pitfall', title: 'Index', maturity: 'verified', tags: [] });
      writeEntry(tmpDir, 'real.md', { id: 'R1', type: 'pitfall', title: 'Real', maturity: 'verified', tags: [] });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('real.md');
      expect(lines.join('')).not.toContain('_index.md');
    });

    it('generates header with stats', () => {
      writeEntry(tmpDir, 'a.md', { id: 'A1', type: 'pitfall', title: 'A', maturity: 'verified', tags: [] });
      writeEntry(tmpDir, 'b.md', { id: 'B1', type: 'architecture', title: 'B', maturity: 'draft', tags: [] });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const output = gen.generate();

      expect(output).toContain('# Knowledge Base Index');
      expect(output).toContain('Total: 2');
      expect(output).toContain('# filename|id|type|title|maturity|tags|terms');
    });
  });

  describe('regenerate', () => {
    it('writes _index.md to baseDir', () => {
      writeEntry(tmpDir, 'test.md', { id: 'T1', type: 'guideline', title: 'Test', maturity: 'verified', tags: ['tdd'] });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      gen.regenerate();

      const indexPath = path.join(tmpDir, '_index.md');
      expect(fs.existsSync(indexPath)).toBe(true);

      const content = fs.readFileSync(indexPath, 'utf-8');
      expect(content).toContain('test.md');
      expect(content).toContain('T1');
      expect(content).toContain('guideline');
    });

    it('overwrites existing index', () => {
      fs.writeFileSync(path.join(tmpDir, '_index.md'), 'old content');
      writeEntry(tmpDir, 'new.md', { id: 'N1', type: 'pitfall', title: 'New', maturity: 'verified', tags: [] });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      gen.regenerate();

      const content = fs.readFileSync(path.join(tmpDir, '_index.md'), 'utf-8');
      expect(content).toContain('new.md');
      expect(content).not.toContain('old content');
    });
  });

  describe('edge cases', () => {
    it('handles empty directory', () => {
      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();
      expect(lines).toHaveLength(0);
    });

    it('handles subdirectories (arch-patterns, skills)', () => {
      fs.mkdirSync(path.join(tmpDir, 'arch-patterns'));
      writeEntry(tmpDir, 'arch-patterns/event.md', {
        id: 'AP-event', type: 'architecture', title: 'Event Pattern', maturity: 'verified', tags: [],
      });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('event.md');
    });

    it('handles missing tags array gracefully', () => {
      writeEntry(tmpDir, 'no-tags.md', {
        id: 'NT1', type: 'pitfall', title: 'No Tags', maturity: 'verified',
      });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      const fields = lines[0].split('|');
      expect(fields[5]).toBe('');
    });

    it('sanitizes newlines in title to preserve single-line format', () => {
      // Simulates YAML block scalar: title: |\n  Line 1\n  Line 2
      fs.writeFileSync(
        path.join(tmpDir, 'guideline-GUI-007.md'),
        '---\nid: GUI-007\ntype: guideline\ntitle: |\n  Line one\n  Line two\nmaturity: archived\ntags: []\n---\nBody\n'
      );

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain('\n');
      const fields = lines[0].split('|');
      expect(fields).toHaveLength(7);
      expect(fields[3]).toBe('Line one Line two');
    });

    it('sanitizes pipe characters in fields', () => {
      writeEntry(tmpDir, 'test.md', {
        id: 'T1', type: 'pitfall', title: 'A | B', maturity: 'verified', tags: ['x|y'],
      });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      const fields = lines[0].split('|');
      expect(fields).toHaveLength(7);
      expect(fields[3]).toBe('A / B');
      expect(fields[5]).toBe('x/y');
    });

    it('detects skill schema (name/description instead of id/type)', () => {
      fs.mkdirSync(path.join(tmpDir, 'skills'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'skills', 'proxy.md'),
        '---\nname: proxy\ndescription: "Proxy skill for testing"\ntrigger: manual\nstatus: active\n---\n## Steps\nDo things\n',
      );

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      const fields = lines[0].split('|');
      expect(fields[1]).toBe('proxy');
      expect(fields[2]).toBe('skill');
      expect(fields[3]).toContain('Proxy skill');
    });

    it('infers type from directory (skills/ → skill, arch-patterns/ → architecture)', () => {
      fs.mkdirSync(path.join(tmpDir, 'arch-patterns'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'arch-patterns', 'event.md'),
        '# Event Pattern\n\n## Lifecycle\nBody\n',
      );

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      const fields = lines[0].split('|');
      expect(fields[2]).toBe('architecture');
    });

    it('infers pattern type from suffix (*-pattern.md)', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'knowledge-quality-pattern.md'),
        '# Quality Pattern\n\n## Dimensions\nBody\n',
      );

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      const fields = lines[0].split('|');
      expect(fields[2]).toBe('pattern');
    });

    it('skips ghost files named .md', () => {
      fs.mkdirSync(path.join(tmpDir, 'skills'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'skills', '.md'), '# Ghost\n');
      writeEntry(tmpDir, 'real.md', { id: 'R1', type: 'pitfall', title: 'Real', maturity: 'verified', tags: [] });

      const gen = new KnowledgeIndexGenerator(tmpDir);
      const lines = gen.generateIndexLines();

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('real.md');
    });
  });
});
