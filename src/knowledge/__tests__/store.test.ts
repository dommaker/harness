/**
 * KnowledgeStore 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { FileKnowledgeStore as KnowledgeStore } from '../store';
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
    executionResults: [],
    consumptionMode: 'reference',
    origin: 'agent',
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

    it('should filter by consumptionMode', () => {
      store.save(makeEntry({ id: 'DEC-001', consumptionMode: 'reference' }));
      store.save(makeEntry({ id: 'DEC-002', consumptionMode: 'rule', title: 'Rule' }));
      store.save(makeEntry({ id: 'DEC-003', consumptionMode: 'signal', title: 'Signal' }));
      const list = store.list({ consumptionModes: ['rule', 'signal'] });
      expect(list).toHaveLength(2);
      expect(list.map(e => e.id).sort()).toEqual(['DEC-002', 'DEC-003']);
    });

    it('should filter by origin', () => {
      store.save(makeEntry({ id: 'DEC-001', origin: 'agent' }));
      store.save(makeEntry({ id: 'DEC-002', origin: 'human', title: 'Human' }));
      const list = store.list({ origins: ['human'] });
      expect(list).toHaveLength(1);
      expect(list[0].origin).toBe('human');
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
    it('should round-trip sourceReferences with entryId through save/load', () => {
      const sourceRefs = [
        { workflow: 'test-flow', step: 'distill', commit: 'abc1234', timestamp: '2026-05-01', entryId: 'SRC-001' },
        { workflow: 'test-flow', timestamp: '2026-05-02' },
      ];
      store.save(makeEntry({ id: 'DEC-001', sourceReferences: sourceRefs }));
      const loaded = store.get('DEC-001');
      expect(loaded?.sourceReferences).toStrictEqual(sourceRefs);
      // 缺省 entryId 的 ref 不落 undefined 键：原始 frontmatter 中 entryId 只出现一次
      const raw = fs.readFileSync(path.join(tempDir, 'decision-DEC-001.md'), 'utf-8');
      expect(raw.match(/entryId/g)).toHaveLength(1);
    });

    it('should round-trip consumptionMode and origin through save/load', () => {
      store.save(makeEntry({
        id: 'DEC-001',
        consumptionMode: 'rule',
        origin: 'human',
        fullContentPath: 'https://example.com/doc',
        skillId: 'skill-001',
      }));
      const loaded = store.get('DEC-001');
      expect(loaded?.consumptionMode).toBe('rule');
      expect(loaded?.origin).toBe('human');
      expect(loaded?.fullContentPath).toBe('https://example.com/doc');
      expect(loaded?.skillId).toBe('skill-001');
    });

    it('should default consumptionMode to reference and origin to agent', () => {
      store.save(makeEntry({ id: 'DEC-001' }));
      const loaded = store.get('DEC-001');
      expect(loaded?.consumptionMode).toBe('reference');
      expect(loaded?.origin).toBe('agent');
    });

    it('getBaseDir() returns configured baseDir', () => {
      expect(store.getBaseDir()).toBe(tempDir);
    });

    it('should create directory if it does not exist', () => {
      const newDir = path.join(process.cwd(), 'temp-test-knowledge-nested', 'sub', 'deep');
      new KnowledgeStore({ baseDir: newDir });
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

  describe('findFile precision (E3)', () => {
    it('should not collide when one id is a suffix of another', () => {
      // pitfall with id containing hyphen: file = pitfall-mppq8n44-1829.md
      const pitfall = makeEntry({
        id: 'PIT-mppq8n44-1829',
        type: 'pitfall',
        title: 'Pitfall Entry',
        content: 'pitfall content',
      });
      // decision with numeric id that is a suffix: file = decision-1829.md
      const decision = makeEntry({
        id: '1829',
        type: 'decision',
        title: 'Decision Entry',
        content: 'decision content',
      });
      store.save(pitfall);
      store.save(decision);

      // get('1829') must return the decision, not the pitfall
      const retrieved = store.get('1829');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('1829');
      expect(retrieved!.type).toBe('decision');

      // get('PIT-mppq8n44-1829') must return the pitfall
      const pit = store.get('PIT-mppq8n44-1829');
      expect(pit).toBeDefined();
      expect(pit!.id).toBe('PIT-mppq8n44-1829');
      expect(pit!.type).toBe('pitfall');
    });

    it('should not collide when id contains type prefix of another entry', () => {
      // model with id that contains "GUI" prefix: file = model-GUI-003.md
      const model = makeEntry({
        id: 'GUI-003',
        type: 'model',
        title: 'Model Entry',
        content: 'model content',
      });
      // guideline with id "003": file = guideline-003.md
      const guideline = makeEntry({
        id: '003',
        type: 'guideline',
        title: 'Guideline Entry',
        content: 'guideline content',
      });
      store.save(model);
      store.save(guideline);

      const retrieved = store.get('003');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('003');
      expect(retrieved!.type).toBe('guideline');
    });

    it('should handle delete correctly with colliding ids', () => {
      const pitfall = makeEntry({
        id: 'PIT-mppq8n44-1829',
        type: 'pitfall',
        title: 'Pitfall Entry',
        content: 'pitfall content',
      });
      const decision = makeEntry({
        id: '1829',
        type: 'decision',
        title: 'Decision Entry',
        content: 'decision content',
      });
      store.save(pitfall);
      store.save(decision);

      // delete('1829') should only delete the decision
      expect(store.delete('1829')).toBe(true);
      expect(store.get('1829')).toBeUndefined();
      // pitfall should still exist
      expect(store.get('PIT-mppq8n44-1829')).toBeDefined();
    });
  });

  describe('snapshot', () => {
    it('should create snapshot file in .snapshots/', () => {
      store.save(makeEntry({ id: 'SNAP-001' }));
      const snapPath = store.snapshot();
      expect(fs.existsSync(snapPath)).toBe(true);
      expect(snapPath).toContain('.snapshots/index-');
      const content = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
      expect(content.length).toBeGreaterThanOrEqual(1);
    });

    it('should overwrite existing snapshot for same date', () => {
      store.save(makeEntry({ id: 'SNAP-001' }));
      store.snapshot();
      store.save(makeEntry({ id: 'SNAP-002', title: 'Second' }));
      store.snapshot();
      const today = new Date().toISOString().slice(0, 10);
      const snapPath = path.join(tempDir, '.snapshots', `index-${today}.json`);
      const content = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
      expect(content.some((e: any) => e.id === 'SNAP-002')).toBe(true);
    });

    it('should read snapshot by date', () => {
      store.save(makeEntry({ id: 'SNAP-001' }));
      store.snapshot();
      const today = new Date().toISOString().slice(0, 10);
      const snapshot = store.getSnapshot(today);
      expect(snapshot).toBeDefined();
      expect(snapshot!.some(e => e.id === 'SNAP-001')).toBe(true);
    });

    it('should return undefined for non-existent snapshot date', () => {
      expect(store.getSnapshot('2020-01-01')).toBeUndefined();
    });
  });

  describe('getSurvivalRate', () => {
    it('should return undefined when no snapshot exists', () => {
      expect(store.getSurvivalRate(30)).toBeUndefined();
    });

    it('should return 100% when all entries still active', () => {
      store.save(makeEntry({ id: 'SUR-001' }));
      store.save(makeEntry({ id: 'SUR-002' }));
      // Create a snapshot with today's date, then check survival against 0 days ago
      store.snapshot();
      // Manually copy snapshot to look like 30 days ago
      const today = new Date().toISOString().slice(0, 10);
      const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const snapDir = path.join(tempDir, '.snapshots');
      fs.copyFileSync(
        path.join(snapDir, `index-${today}.json`),
        path.join(snapDir, `index-${pastDate}.json`),
      );
      const result = store.getSurvivalRate(30);
      expect(result).toBeDefined();
      expect(result!.rate).toBe(100);
      expect(result!.survived).toBe(2);
      expect(result!.total).toBe(2);
    });

    it('should count archived entries as not survived', () => {
      store.save(makeEntry({ id: 'SUR-001' }));
      store.save(makeEntry({ id: 'SUR-002' }));
      store.snapshot();
      // Archive one entry after snapshot
      store.update('SUR-002', { maturity: 'archived' });
      // Copy snapshot to 30 days ago
      const today = new Date().toISOString().slice(0, 10);
      const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const snapDir = path.join(tempDir, '.snapshots');
      fs.copyFileSync(
        path.join(snapDir, `index-${today}.json`),
        path.join(snapDir, `index-${pastDate}.json`),
      );
      const result = store.getSurvivalRate(30);
      expect(result!.rate).toBe(50);
      expect(result!.survived).toBe(1);
      expect(result!.total).toBe(2);
    });
  });

  describe('readIndex memoize（harness#106）', () => {
    // fs.readFileSync 不可 spy（Node 21+ 不可 redefine）；list/readIndex 路径上
    // JSON.parse 仅用于解析 index.json，用其调用次数度量 index 重读次数
    it('list() 单次调用内 index.json 只解析一次（消除 N+1 重读）', () => {
      store.save(makeEntry({ id: 'DEC-001' }));
      store.save(makeEntry({ id: 'DEC-002', title: 'Second' }));

      const parseSpy = jest.spyOn(JSON, 'parse');
      try {
        store.list();
        expect(parseSpy).toHaveBeenCalledTimes(1);
      } finally {
        parseSpy.mockRestore();
      }
    });

    it('readIndex() 重复调用命中缓存，不重复解析', () => {
      store.save(makeEntry({ id: 'DEC-001' }));

      const parseSpy = jest.spyOn(JSON, 'parse');
      try {
        store.readIndex();
        store.readIndex();
        expect(parseSpy).toHaveBeenCalledTimes(1);
      } finally {
        parseSpy.mockRestore();
      }
    });

    it('index.json 变更后缓存自动失效（mtime+size 指纹）', () => {
      store.save(makeEntry({ id: 'DEC-001' }));
      const first = store.readIndex();
      expect(first).toHaveLength(1);

      // 模拟外部进程直接改写 index.json
      const indexPath = path.join(tempDir, 'index.json');
      const external = [...first, { ...first[0], id: 'DEC-EXT' }];
      fs.writeFileSync(indexPath, JSON.stringify(external, null, 2), 'utf-8');

      const second = store.readIndex();
      expect(second.map(e => e.id)).toContain('DEC-EXT');
    });

    it('index.json 被删除后缓存失效，readIndex 返回空', () => {
      store.save(makeEntry({ id: 'DEC-001' }));
      expect(store.readIndex()).toHaveLength(1);

      fs.unlinkSync(path.join(tempDir, 'index.json'));
      expect(store.readIndex()).toHaveLength(0);
    });
  });

  describe('frontmatter 收口（harness#89）', () => {
    const entryPath = (id: string): string => path.join(tempDir, `decision-${id}.md`);
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('load→save 往返字节稳定：已落盘条目不产生无意义 diff', () => {
      store.save(makeEntry({ id: 'FM-001' }));
      const before = fs.readFileSync(entryPath('FM-001'), 'utf-8');

      const loaded = store.get('FM-001')!;
      store.save(loaded);

      expect(fs.readFileSync(entryPath('FM-001'), 'utf-8')).toBe(before);
    });

    it('正文含 --- 分隔线的条目往返字节稳定，正文完整保留', () => {
      const body = '第一段\n\n---\n\n## 附录\n末行\n';
      store.save(makeEntry({ id: 'FM-002', content: body }));
      const before = fs.readFileSync(entryPath('FM-002'), 'utf-8');

      const loaded = store.get('FM-002')!;
      expect(loaded.content).toBe(body);
      store.save(loaded);

      expect(fs.readFileSync(entryPath('FM-002'), 'utf-8')).toBe(before);
    });

    it('未闭合 frontmatter：跳过条目并显式上报（不再静默丢，口径与 migration 同派）', () => {
      fs.writeFileSync(entryPath('FM-003'), '---\nid: FM-003\ntype: decision\n', 'utf-8');

      expect(store.get('FM-003')).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[harness\].*unterminated/);
    });

    it('YAML 非法 frontmatter：跳过条目并显式上报', () => {
      fs.writeFileSync(entryPath('FM-004'), '---\nid: [1,\n---\n\nBody\n', 'utf-8');

      expect(store.get('FM-004')).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[harness\].*invalid-yaml/);
    });

    it('空 meta：按无 frontmatter 处理（absent）——跳过且不上报', () => {
      fs.writeFileSync(entryPath('FM-005'), '---\n\n---\n\nBody\n', 'utf-8');

      expect(store.get('FM-005')).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('缺 frontmatter：合法的非条目文件——跳过且不上报', () => {
      fs.writeFileSync(entryPath('FM-006'), '# 只是普通 markdown\n\n正文\n', 'utf-8');

      expect(store.get('FM-006')).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
