/**
 * 知识树 walker 排除口径单点化（harness#134，架构评审候选 4）
 *
 * 判据不是「各文件有没有抄同一份常量」，而是**同一份知识树在四个入口下得到同一份条目人口**：
 * store 顶层扫描、migration 顶层扫描、index-generator 递归扫描此前各有各的排除口径，
 * 后果是 `harness knowledge index` 落在 baseDir 的 `_index.md`（生成物、无 frontmatter）
 * 被 `harness knowledge migrate` 判成「no frontmatter found」计入 errors——同一份树，
 * `store.list()` 报 1 条、`migrateKnowledgeEntries` 报 total 2 / errors 1。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isEntryFile, isInfraDir, INDEX_MD_FILE, SNAPSHOTS_DIR } from '../tree-walker';
import { FileKnowledgeStore } from '../store';
import { KnowledgeIndexGenerator } from '../index-generator';
import { migrateKnowledgeEntries } from '../migration';
import type { KnowledgeEntry } from '../types';

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'TREE-001',
    type: 'guideline',
    title: 'Tree Walker Entry',
    content: '内容足够长以通过各口径的判定阈值要求'.repeat(3),
    maturity: 'verified',
    layer: 'project',
    created: '2026-09-01T00:00:00.000Z',
    lastReferenced: '2026-09-01T00:00:00.000Z',
    contributors: ['a'],
    projects: ['p'],
    tags: [],
    applicablePhases: [],
    sourceReferences: [],
    referencedBy: [],
    executionResults: [],
    consumptionMode: 'reference',
    origin: 'agent',
    ...overrides,
  };
}

describe('tree-walker 谓词', () => {
  it('条目文件判定：仅 .md 且非生成物', () => {
    expect(isEntryFile('guideline-A.md')).toBe(true);
    expect(isEntryFile(INDEX_MD_FILE)).toBe(false);
    expect(isEntryFile('notes.txt')).toBe(false);
    expect(isEntryFile('index.json')).toBe(false);
  });

  it('基建目录判定：归档/快照/resolution 都不是条目人口', () => {
    for (const dir of ['.archive', 'archived', SNAPSHOTS_DIR, 'resolutions']) {
      expect(isInfraDir(dir)).toBe(true);
    }
    expect(isInfraDir('skills')).toBe(false);
    expect(isInfraDir('.harness')).toBe(false);
  });
});

describe('四个 walker 的条目人口一致（同一份树）', () => {
  let dir: string;

  /**
   * 平铺知识库：2 个真条目 + 全部基建产物（_index.md / .snapshots / .archive / resolutions）
   * 只放平铺层，因为 store 与 migration 本就是顶层扫描器、index-generator 会下钻业务子目录——
   * 本票统一的是**排除口径**，不是递归深度。
   */
  function buildTree(): void {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-walker-'));
    const store = new FileKnowledgeStore({ baseDir: dir });
    store.save(makeEntry({ id: 'TREE-001' }));
    store.save(makeEntry({ id: 'TREE-002', type: 'pitfall', title: 'Another Entry' }));

    for (const sub of ['.snapshots', '.archive', 'resolutions']) {
      fs.mkdirSync(path.join(dir, sub), { recursive: true });
    }
    fs.writeFileSync(
      path.join(dir, '.snapshots', 'index-2026-08-01.json'),
      JSON.stringify([{ id: 'TREE-001', type: 'guideline' }]),
      'utf-8'
    );
    // 基建目录里的 .md 带着合法 frontmatter：口径若漏了排除，它们会冒充条目
    const fakeEntry = (id: string): string =>
      `---\nid: ${id}\ntype: pitfall\ntitle: Ghost ${id}\nmaturity: verified\nlayer: project\n` +
      `created: 2026-08-01T00:00:00.000Z\nlastReferenced: ''\ncontributors: []\nprojects: []\n` +
      `tags: []\napplicablePhases: []\nsourceReferences: []\nreferencedBy: []\nexecutionResults: []\n` +
      `consumptionMode: reference\norigin: agent\n---\n\nGhost body\n`;
    fs.writeFileSync(path.join(dir, '.archive', 'ghost.md'), fakeEntry('GHOST-ARCHIVE'), 'utf-8');
    fs.writeFileSync(path.join(dir, 'resolutions', 'ghost.md'), fakeEntry('GHOST-RESOLUTION'), 'utf-8');

    // 生成物落回同一目录：knowledge index 的真实产物形状
    new KnowledgeIndexGenerator(dir).regenerate();
  }

  beforeEach(buildTree);
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('store 顶层扫描：_index.md 与快照目录不冒充条目', () => {
    const store = new FileKnowledgeStore({ baseDir: dir });
    expect(store.list({ excludeArchived: false }).map(e => e.id).sort()).toEqual(['TREE-001', 'TREE-002']);
    expect(store.readEntriesFromDisk().map(e => e.id).sort()).toEqual(['TREE-001', 'TREE-002']);
    store.rebuildIndex();
    expect(store.readIndex().map(e => e.id).sort()).toEqual(['TREE-001', 'TREE-002']);
  });

  it('migration：生成物既不计入 total 也不计入 errors（修假阳性）', () => {
    const result = migrateKnowledgeEntries(dir);
    expect(result.total).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('index-generator：基建目录与 _index.md 一律不出现在索引行里', () => {
    const lines = new KnowledgeIndexGenerator(dir).generateIndexLines();
    const files = lines.map(l => l.split('|')[0]);
    expect(files.sort()).toEqual(['guideline-TREE-001.md', 'pitfall-TREE-002.md']);
  });

  it('三处对撞：条目集合逐 id 相同（口径漂移即红）', () => {
    const store = new FileKnowledgeStore({ baseDir: dir });
    const fromStore = store.list({ excludeArchived: false }).map(e => e.id).sort();
    const fromDisk = store.readEntriesFromDisk().map(e => e.id).sort();
    const fromIndex = new KnowledgeIndexGenerator(dir)
      .generateIndexLines()
      .map(l => l.split('|')[1])
      .sort();
    expect({ fromStore, fromDisk, fromIndex }).toEqual({
      fromStore: ['TREE-001', 'TREE-002'],
      fromDisk: ['TREE-001', 'TREE-002'],
      fromIndex: ['TREE-001', 'TREE-002'],
    });
  });
});
