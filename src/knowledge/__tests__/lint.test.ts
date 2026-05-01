/**
 * KnowledgeLinter 测试
 */

import { KnowledgeLinter } from '../lint';
import { KnowledgeStore } from '../store';
import { ReferenceTracker } from '../reference-tracker';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('KnowledgeLinter', () => {
  let store: KnowledgeStore;
  let tracker: ReferenceTracker;
  let linter: KnowledgeLinter;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linter-test-'));
    store = new KnowledgeStore({ baseDir: path.join(tmpDir, 'knowledge') });
    tracker = new ReferenceTracker(store);
    linter = new KnowledgeLinter(store, tracker);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function saveEntry(overrides: any = {}) {
    store.save({
      id: overrides.id || `test-${Math.random().toString(36).slice(2, 6)}`,
      type: 'decision',
      title: 'Test Decision',
      content: 'Some content',
      maturity: 'draft',
      layer: 'project',
      created: new Date().toISOString(),
      lastReferenced: '',
      contributors: [],
      projects: [],
      tags: [],
      applicablePhases: [],
      sourceReferences: [],
      referencedBy: [],
      ...overrides,
    });
  }

  describe('run', () => {
    it('应该返回空报告当无条目', () => {
      const report = linter.run();
      expect(report.totalEntries).toBe(0);
      expect(report.issues.length).toBe(0);
      expect(report.fixed).toBe(0);
    });

    it('应该检测所有问题类型', () => {
      // 孤儿条目
      saveEntry({ id: 'orphan-1', title: 'Orphan', maturity: 'draft', contributors: [], projects: [] });
      // 过时条目
      saveEntry({
        id: 'outdated-1',
        title: 'Old',
        maturity: 'draft',
        created: '2020-01-01T00:00:00.000Z',
        lastReferenced: '',
      });
      // 重复条目
      saveEntry({ id: 'dup-1', title: 'Same Title', type: 'decision' });
      saveEntry({ id: 'dup-2', title: 'Same Title', type: 'decision' });

      const report = linter.run();
      expect(report.summary.orphan).toBeGreaterThan(0);
      expect(report.summary.outdated).toBeGreaterThan(0);
      expect(report.summary.duplicate).toBeGreaterThan(0);
    });
  });

  describe('checkIndexConsistency', () => {
    it('应该检测索引中有但文件不存在的条目', () => {
      saveEntry({ id: 'entry-1' });
      // 手动删除文件但保留索引
      const files = fs.readdirSync(path.join(tmpDir, 'knowledge'));
      for (const f of files) {
        if (f.endsWith('.md')) {
          fs.unlinkSync(path.join(tmpDir, 'knowledge', f));
        }
      }

      const report = linter.run();
      expect(report.summary.index_inconsistent).toBeGreaterThan(0);
      expect(report.issues.some(i => i.description.includes('无对应文件'))).toBe(true);
    });

    it('应该检测文件存在但不在索引中的条目', () => {
      // 先保存条目（会同时创建文件和索引）
      saveEntry({ id: 'entry-2' });
      // 手动删除索引中该条目，但保留文件
      const indexPath = path.join(tmpDir, 'knowledge', 'index.json');
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const filtered = index.filter((e: any) => e.id !== 'entry-2');
      fs.writeFileSync(indexPath, JSON.stringify(filtered), 'utf-8');

      const report = linter.run();
      expect(report.summary.index_inconsistent).toBeGreaterThan(0);
      expect(report.issues.some(i => i.description.includes('不在索引中'))).toBe(true);
    });
  });

  describe('checkOrphans', () => {
    it('应该检测孤儿条目', () => {
      saveEntry({ id: 'orphan-1', maturity: 'draft', contributors: [], projects: [] });
      const issues = linter.checkOrphans(store.list({ excludeArchived: false }));
      expect(issues.some(i => i.type === 'orphan')).toBe(true);
    });

    it('不应该标记有贡献者的条目', () => {
      saveEntry({ id: 'not-orphan', contributors: ['user-1'], projects: [] });
      const issues = linter.checkOrphans(store.list({ excludeArchived: false }));
      expect(issues.filter(i => i.entryId === 'not-orphan').length).toBe(0);
    });

    it('不应该标记 archived 条目', () => {
      saveEntry({ id: 'archived-1', maturity: 'archived', contributors: [], projects: [] });
      const issues = linter.checkOrphans(store.list({ excludeArchived: false }));
      expect(issues.filter(i => i.entryId === 'archived-1').length).toBe(0);
    });
  });

  describe('checkOutdated', () => {
    it('应该检测超过 6 个月未引用的 draft', () => {
      saveEntry({
        id: 'old-draft',
        maturity: 'draft',
        created: '2020-01-01T00:00:00.000Z',
        lastReferenced: '',
      });
      const issues = linter.checkOutdated(store.list({ excludeArchived: false }));
      expect(issues.some(i => i.type === 'outdated')).toBe(true);
    });

    it('不应该标记最近引用的条目', () => {
      saveEntry({
        id: 'recent',
        maturity: 'draft',
        lastReferenced: new Date().toISOString(),
      });
      const issues = linter.checkOutdated(store.list({ excludeArchived: false }));
      expect(issues.filter(i => i.entryId === 'recent').length).toBe(0);
    });

    it('不应该标记 proven 条目即使很久未引用', () => {
      saveEntry({
        id: 'old-proven',
        maturity: 'proven',
        created: '2020-01-01T00:00:00.000Z',
        lastReferenced: '',
      });
      const issues = linter.checkOutdated(store.list({ excludeArchived: false }));
      expect(issues.filter(i => i.entryId === 'old-proven').length).toBe(0);
    });
  });

  describe('checkDuplicates', () => {
    it('应该检测同类型同标题的重复条目', () => {
      saveEntry({ id: 'dup-1', title: 'Same', type: 'decision' });
      saveEntry({ id: 'dup-2', title: 'Same', type: 'decision' });
      const issues = linter.checkDuplicates(store.list({ excludeArchived: false }));
      expect(issues.filter(i => i.type === 'duplicate').length).toBe(2);
    });

    it('不应该标记不同类型同标题的条目', () => {
      saveEntry({ id: 'a-1', title: 'Same', type: 'decision' });
      saveEntry({ id: 'b-1', title: 'Same', type: 'guideline' });
      const issues = linter.checkDuplicates(store.list({ excludeArchived: false }));
      expect(issues.filter(i => i.type === 'duplicate').length).toBe(0);
    });

    it('应该忽略大小写', () => {
      saveEntry({ id: 'c-1', title: 'My Title', type: 'decision' });
      saveEntry({ id: 'c-2', title: 'my title', type: 'decision' });
      const issues = linter.checkDuplicates(store.list({ excludeArchived: false }));
      expect(issues.filter(i => i.type === 'duplicate').length).toBe(2);
    });
  });

  describe('checkContradictions', () => {
    it('应该检测同标签成熟度差异大的条目', () => {
      saveEntry({ id: 'high-1', title: 'High', maturity: 'proven', tags: ['auth'] });
      saveEntry({ id: 'low-1', title: 'Low', maturity: 'draft', tags: ['auth'] });
      const issues = linter.checkContradictions(store.list({ excludeArchived: false }));
      expect(issues.some(i => i.type === 'contradiction')).toBe(true);
    });

    it('不应该标记同成熟度的条目', () => {
      saveEntry({ id: 'eq-1', title: 'A', maturity: 'verified', tags: ['db'] });
      saveEntry({ id: 'eq-2', title: 'B', maturity: 'verified', tags: ['db'] });
      const issues = linter.checkContradictions(store.list({ excludeArchived: false }));
      expect(issues.filter(i => i.type === 'contradiction').length).toBe(0);
    });

    it('应该忽略无标签的条目', () => {
      saveEntry({ id: 'no-tag-1', maturity: 'proven', tags: [] });
      saveEntry({ id: 'no-tag-2', maturity: 'draft', tags: [] });
      const issues = linter.checkContradictions(store.list({ excludeArchived: false }));
      expect(issues.filter(i => i.type === 'contradiction').length).toBe(0);
    });
  });

  describe('autoFix', () => {
    it('应该修复索引不一致', () => {
      saveEntry({ id: 'entry-1' });
      // 删除文件
      const files = fs.readdirSync(path.join(tmpDir, 'knowledge'));
      for (const f of files) {
        if (f.endsWith('.md')) {
          fs.unlinkSync(path.join(tmpDir, 'knowledge', f));
        }
      }

      const report = linter.run(true);
      expect(report.fixed).toBeGreaterThan(0);
    });

    it('应该归档过时条目', () => {
      saveEntry({
        id: 'old-1',
        maturity: 'draft',
        created: '2020-01-01T00:00:00.000Z',
        lastReferenced: '',
      });

      const report = linter.run(true);
      expect(report.fixed).toBeGreaterThan(0);
      const entry = store.get('old-1');
      expect(entry?.maturity).toBe('archived');
    });
  });
});
