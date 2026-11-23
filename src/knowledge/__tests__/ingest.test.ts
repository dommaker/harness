/**
 * KnowledgeIngest 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { FileKnowledgeStore as KnowledgeStore } from '../store';
import { KnowledgeIngest } from '../ingest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// D7 IO 计数：包装真实 fs（照 audit-write-count 手法）。数知识目录扫描（readdirSync）
// 与 index.json 落盘（writeFileSync），夹具清理不计——用例内先清零再动作。
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  const g = globalThis as unknown as { __D7_READDIRS__?: string[]; __D7_INDEX_WRITES__?: string[] };
  if (!g.__D7_READDIRS__) g.__D7_READDIRS__ = [];
  if (!g.__D7_INDEX_WRITES__) g.__D7_INDEX_WRITES__ = [];
  const readdirBucket = g.__D7_READDIRS__;
  const indexWriteBucket = g.__D7_INDEX_WRITES__;
  const name = (p: unknown): string => (Buffer.isBuffer(p) ? p.toString('utf8') : String(p));
  return {
    ...actual,
    readdirSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      readdirBucket.push(name(p));
      return (actual.readdirSync as (...args: unknown[]) => unknown)(p, ...rest);
    }),
    writeFileSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      // 不能用 path 模块（jest.mock 工厂禁引闭包外变量）：条目文件名形如 `<type>-<id>.md`，
      // index 落盘文件名恰为 index.json，endsWith 判定无歧义
      if (name(p).endsWith('index.json')) indexWriteBucket.push(name(p));
      return (actual.writeFileSync as (...args: unknown[]) => unknown)(p, ...rest);
    }),
  };
});

const dirScans = (): string[] =>
  ((globalThis as unknown as { __D7_READDIRS__?: string[] }).__D7_READDIRS__ ||= []);
const indexWrites = (): string[] =>
  ((globalThis as unknown as { __D7_INDEX_WRITES__?: string[] }).__D7_INDEX_WRITES__ ||= []);

describe('KnowledgeIngest', () => {
  let tempDir: string;
  let store: KnowledgeStore;
  let ingest: KnowledgeIngest;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-ingest-'));
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
      const { entry } = ingest.ingestEntry(
        { title: 'Test', content: 'Content', type: 'decision' },
        { source: 'test', layer: 'project' },
      );
      expect(entry.id).toMatch(/^DEC-\d{3}$/);
      expect(entry.title).toBe('Test');
      expect(entry.maturity).toBe('draft');
    });

    it('should use provided id', () => {
      const { entry } = ingest.ingestEntry(
        { id: 'CUSTOM-001', title: 'Test', type: 'guideline' },
        { source: 'test', layer: 'project' },
      );
      expect(entry.id).toBe('CUSTOM-001');
    });

    it('should merge tags from options and entry', () => {
      const { entry } = ingest.ingestEntry(
        { title: 'Test', type: 'decision', tags: ['arch'] },
        { source: 'test', layer: 'project', tags: ['db'] },
      );
      expect(entry.tags).toContain('arch');
      expect(entry.tags).toContain('db');
    });

    it('should use maturity from options', () => {
      const { entry } = ingest.ingestEntry(
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
      const { entry: merged } = ingest.ingestEntry(
        { title: 'Duplicate', content: 'Updated', type: 'decision', contributors: ['alice'] },
        { source: 'test', layer: 'project' },
      );
      expect(merged.content).toBe('Updated');
      expect(merged.contributors).toContain('alice');
      // Should only have one entry in the store
      expect(store.list()).toHaveLength(1);
    });

    it('should use incoming maturity when merging duplicate entries', () => {
      // First ingest creates entry with default maturity (draft)
      const { entry: first } = ingest.ingestEntry(
        { title: 'MaturityTest', content: 'Original', type: 'pitfall' },
        { source: 'test', layer: 'project', maturity: 'verified' },
      );
      expect(first.maturity).toBe('verified');

      // Second ingest merges with explicit draft maturity (LLM extraction scenario)
      const { entry: merged } = ingest.ingestEntry(
        { title: 'MaturityTest', content: 'Updated content', type: 'pitfall' },
        { source: 'test', layer: 'project', maturity: 'draft' },
      );
      expect(merged.maturity).toBe('draft');
      expect(store.list()).toHaveLength(1);
    });

    it('should preserve existing maturity when incoming has no explicit maturity', () => {
      ingest.ingestEntry(
        { title: 'PreserveTest', content: 'Original', type: 'guideline' },
        { source: 'test', layer: 'project', maturity: 'verified' },
      );
      const { entry: merged } = ingest.ingestEntry(
        { title: 'PreserveTest', content: 'Updated', type: 'guideline' },
        { source: 'test', layer: 'project' },
      );
      expect(merged.maturity).toBe('verified');
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

    it('同类型条目 id 序号批内递增（harness#107）', () => {
      const entries = ingest.ingestBatch(
        [
          { title: 'First', type: 'decision' },
          { title: 'Second', type: 'decision' },
          { title: 'Third', type: 'decision' },
        ],
        { source: 'test', layer: 'project' },
      );
      expect(entries.map(r => r.entry.id)).toEqual(['DEC-001', 'DEC-002', 'DEC-003']);
    });
  });

  describe('ingestBatch 共享去重视图（D7）', () => {
    // 夹具纪律（回修）：D7 块每轮独立 mkdtemp + afterEach 清理，不挂共享 tempDir。
    // 内层 let 遮蔽外层同名变量，用例体无需改动。
    let tempDir: string;
    let store: KnowledgeStore;
    let ingest: KnowledgeIngest;

    const longContent = (seed: string): string => `${seed} `.repeat(40).trim();

    const fullEntry = (overrides: Record<string, unknown>) => ({
      id: 'DEC-000',
      type: 'decision' as const,
      title: 'Seed',
      content: longContent('seed'),
      maturity: 'draft' as const,
      layer: 'project' as const,
      created: '2026-05-01T00:00:00.000Z',
      lastReferenced: '',
      contributors: [],
      projects: [],
      tags: [],
      applicablePhases: [],
      sourceReferences: [],
      referencedBy: [],
      executionResults: [],
      consumptionMode: 'reference' as const,
      origin: 'agent' as const,
      ...overrides,
    });

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd7-ingest-view-'));
      store = new KnowledgeStore({ baseDir: tempDir });
      ingest = new KnowledgeIngest(store);
      dirScans().length = 0;
      indexWrites().length = 0;
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('去重扫描每批一次：目录扫描不随批内条目数放大', () => {
      const results = ingest.ingestBatch(
        [
          { title: 'BatchViewOne', type: 'decision', content: 'content number one here' },
          { title: 'BatchViewTwo', type: 'decision', content: 'content number two here' },
          { title: 'BatchViewThree', type: 'decision', content: 'content number three here' },
        ],
        { source: 'test', layer: 'project' },
      );

      expect(results.every(r => r.status === 'accepted')).toBe(true);
      expect(store.list()).toHaveLength(3); // 正对照：三条真落库
      expect(dirScans().filter(p => p === tempDir)).toHaveLength(1);
    });

    it('批内同标题：第二条经共享视图 merge 进第一条，store 只有一条', () => {
      const results = ingest.ingestBatch(
        [
          { title: 'BatchDupTitle', type: 'decision', content: 'first version body here' },
          { title: 'BatchDupTitle', type: 'decision', content: 'second version body here' },
        ],
        { source: 'test', layer: 'project' },
      );

      expect(results[0].status).toBe('accepted');
      expect(results[1].status).toBe('accepted');
      expect(results[1].entry.content).toBe('second version body here');
      expect(store.list()).toHaveLength(1);
    });

    it('整批预校验：批内一条脏枚举值全批拒写，不制造已落盘假象', () => {
      expect(() => ingest.ingestBatch(
        [
          { title: 'DirtyBatchItem', type: 'decision', content: 'valid content here', maturity: 'bogus' as never },
          { title: 'CleanBatchItem', type: 'decision', content: 'valid content here' },
        ],
        { source: 'test', layer: 'project' },
      )).toThrow(/maturity.*bogus/);
      // 半个批次都不落：合法条目也一并拒写（saveAll 整批预校验语义）
      expect(store.list({ excludeArchived: false })).toHaveLength(0);
      expect(fs.readdirSync(tempDir).filter(f => f.endsWith('.md'))).toHaveLength(0);
    });

    it('stale index 下批内 disk 去重仍成立（共享视图以盘为基线）', () => {
      ingest.ingestEntry(
        { title: 'StaleIndexBatch', type: 'decision', content: 'original body content' },
        { source: 'test', layer: 'project' },
      );

      // 腐蚀 index 模拟漂移现场
      fs.writeFileSync(path.join(tempDir, 'index.json'), '[]', 'utf-8');

      const results = ingest.ingestBatch(
        [{ title: 'StaleIndexBatch', type: 'decision', content: 'updated body content' }],
        { source: 'test', layer: 'project' },
      );

      expect(results[0].status).toBe('accepted');
      const mdFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.md'));
      expect(mdFiles).toHaveLength(1);
    });

    it('已有条目同批 merge 两次：第二次基于第一次终态，contributors/content 链式累积', () => {
      store.save(fullEntry({
        id: 'DEC-000', title: 'MergeChain', content: longContent('v0'), contributors: ['carol'],
      }));

      const results = ingest.ingestBatch(
        [
          { title: 'MergeChain', type: 'decision', content: longContent('v1'), contributors: ['alice'] },
          { title: 'MergeChain', type: 'decision', content: longContent('v2'), contributors: ['bob'] },
        ],
        { source: 'test', layer: 'project' },
      );

      expect(results.map(r => r.status)).toEqual(['accepted', 'accepted']);
      const chains = store.list({ excludeArchived: false }).filter(e => e.title === 'MergeChain');
      expect(chains).toHaveLength(1);
      // 旧逐条路径：第二次 merge 读到第一次的落盘终态 → carol+alice 之上再叠 bob
      expect(chains[0].contributors).toEqual(['carol', 'alice', 'bob']);
      expect(chains[0].content.startsWith('v2 ')).toBe(true);
    });

    it('本批两条同标题 merge 后再新建：自动序号与旧逐条路径一致（虚拟 index 按 id 去重）', () => {
      const results = ingest.ingestBatch(
        [
          { title: 'ChainNew', type: 'decision', content: longContent('n1') },
          { title: 'ChainNew', type: 'decision', content: longContent('n2') },
          { title: 'ChainFresh', type: 'decision', content: longContent('n3') },
        ],
        { source: 'test', layer: 'project' },
      );

      // 旧逐条路径：第二条 merge 不产生新 id，第三条在 DEC-001 之上取 DEC-002
      expect(results.map(r => r.entry.id)).toEqual(['DEC-001', 'DEC-001', 'DEC-002']);
      expect(store.list({ excludeArchived: false })).toHaveLength(2);
    });
  });

  describe('ingestBatch 统一落盘（D7）', () => {
    // 夹具纪律（回修）：每轮独立 mkdtemp + afterEach 清理，内层 let 遮蔽外层共享夹具
    let tempDir: string;
    let store: KnowledgeStore;
    let ingest: KnowledgeIngest;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd7-ingest-plan-'));
      store = new KnowledgeStore({ baseDir: tempDir });
      ingest = new KnowledgeIngest(store);
      dirScans().length = 0;
      indexWrites().length = 0;
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const longContent = (seed: string): string => `${seed} `.repeat(40).trim();

    it('K 条新建全批只重写一次 index.json', () => {
      const results = ingest.ingestBatch(
        [
          { title: 'UnifiedOne', type: 'decision', content: longContent('one') },
          { title: 'UnifiedTwo', type: 'decision', content: longContent('two') },
          { title: 'UnifiedThree', type: 'decision', content: longContent('three') },
        ],
        { source: 'test', layer: 'project' },
      );

      expect(results.every(r => r.status === 'accepted')).toBe(true);
      expect(store.list()).toHaveLength(3); // 正对照：三条真落库
      expect(indexWrites().filter(p => p === path.join(tempDir, 'index.json'))).toHaveLength(1);
    });

    it('含 merge 的混合批也只重写一次 index.json', () => {
      ingest.ingestEntry(
        { title: 'UnifiedMerge', type: 'decision', content: longContent('original') },
        { source: 'test', layer: 'project' },
      );
      indexWrites().length = 0;

      const results = ingest.ingestBatch(
        [
          { title: 'UnifiedMerge', type: 'decision', content: longContent('updated') },
          { title: 'UnifiedFresh', type: 'decision', content: longContent('fresh') },
        ],
        { source: 'test', layer: 'project' },
      );

      expect(results.every(r => r.status === 'accepted')).toBe(true);
      expect(store.list()).toHaveLength(2);
      expect(store.list().find(e => e.title === 'UnifiedMerge')!.content).toContain('updated');
      expect(indexWrites().filter(p => p === path.join(tempDir, 'index.json'))).toHaveLength(1);
    });

    it('含 auto-fix 的批也只重写一次 index.json', () => {
      const results = ingest.ingestBatch(
        [
          // 不同类型避免 test-scope → archived 后虚拟序号碰撞（该碰撞语义由上一用例钉住）
          { title: 'UnifiedFixOne', type: 'decision', content: longContent('a'), tags: ['test-scope-1'] },
          { title: 'UnifiedFixTwo', type: 'pitfall', content: longContent('b') },
        ],
        { source: 'test', layer: 'project' },
      );

      expect(results.every(r => r.status === 'accepted')).toBe(true);
      // auto-fix 终态照常落盘（第一条 archived）
      const fixed = store.list({ excludeArchived: false }).find(e => e.title === 'UnifiedFixOne')!;
      expect(fixed.maturity).toBe('archived');
      expect(indexWrites().filter(p => p === path.join(tempDir, 'index.json'))).toHaveLength(1);
    });

    it('auto-fix 后 maturity 即时进虚拟 index：批内序号口径复刻旧逐条路径（回归）', () => {
      // 探针确认的旧行为：前两条带 test-scope tag → 被 auto-fix 成 archived →
      // archived 不计序号，后一条重新拿到 DEC-001，后写覆盖前写，store 只剩最后一条
      const results = ingest.ingestBatch(
        [
          { title: 'CollisionOne', type: 'decision', content: longContent('x'), tags: ['test-scope-c'] },
          { title: 'CollisionTwo', type: 'decision', content: longContent('y'), tags: ['test-scope-c'] },
          { title: 'CollisionThree', type: 'decision', content: longContent('z') },
        ],
        { source: 'test', layer: 'project' },
      );

      expect(results.map(r => r.entry.id)).toEqual(['DEC-001', 'DEC-001', 'DEC-001']);
      expect(store.list({ excludeArchived: false })).toHaveLength(1);
      const survivor = store.list({ excludeArchived: false })[0];
      expect(survivor.title).toBe('CollisionThree');
      expect(survivor.maturity).toBe('draft');
    });

    it('全批被拒（脏枚举）零 index 写入', () => {
      expect(() => ingest.ingestBatch(
        [{ title: 'AllDirty', type: 'decision', content: longContent('d'), maturity: 'bogus' as never }],
        { source: 'test', layer: 'project' },
      )).toThrow(/maturity.*bogus/);
      expect(indexWrites()).toHaveLength(0);
    });

    it('空批零读写', () => {
      const results = ingest.ingestBatch([], { source: 'test', layer: 'project' });
      expect(results).toEqual([]);
      expect(dirScans().filter(p => p === tempDir)).toHaveLength(0);
      expect(indexWrites()).toHaveLength(0);
      expect(fs.existsSync(path.join(tempDir, 'index.json'))).toBe(false);
    });
  });

  describe('generateId 走索引计数（harness#107）', () => {
    it('不再经 store.list() 逐条读条目文件', () => {
      const listSpy = jest.spyOn(store, 'list');
      try {
        ingest.ingestEntry(
          { title: 'Test', content: 'Content', type: 'decision' },
          { source: 'test', layer: 'project' },
        );
        expect(listSpy).not.toHaveBeenCalled();
      } finally {
        listSpy.mockRestore();
      }
    });

    it('archived/deprecated 条目不计入序号（与 list 默认过滤口径一致）', () => {
      store.save({
        id: 'DEC-001',
        type: 'decision',
        title: 'Archived One',
        content: 'Original',
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
        executionResults: [],
        consumptionMode: 'reference',
        origin: 'agent',
      });
      store.update('DEC-001', { maturity: 'archived' });

      const { entry } = ingest.ingestEntry(
        { title: 'Fresh', content: 'Content', type: 'decision' },
        { source: 'test', layer: 'project' },
      );
      expect(entry.id).toBe('DEC-001');
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
      const { entry: merged } = ingest.ingestEntry(
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
        executionResults: [],
      consumptionMode: 'reference',
      origin: 'agent',
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

  describe('pitfall dedup (#3)', () => {
    it('should detect duplicate pitfall by content window containment', () => {
      // Same root cause, different titles — like real PIT-002 / PIT-mppq8n44-1829
      // Content is body text only (no frontmatter) — same format as system-produced entries
      store.save({
        id: 'PIT-001', type: 'pitfall', title: 'events-daemon 与 API 端口不匹配',
        content: '根因：events-daemon 默认使用 3001 端口连接 API，但实际 API 运行在 13101 端口，导致 session:archive 事件无法被正确接收和处理。责任归属：开发流程缺乏端口一致性校验机制。',
        maturity: 'verified', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [],
        executionResults: [],
      consumptionMode: 'reference',
      origin: 'agent',
      });

      // Different title, same root cause content → should merge
      const { entry: merged } = ingest.ingestEntry(
        {
          title: '端口不匹配导致事件处理失败',
          content: '根因：events-daemon 默认使用 3001 端口连接 API，但实际 API 运行在 13101 端口。责任：启动配置未显式指定 API_PORT 环境变量。',
          type: 'pitfall',
        },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['pitfall'] })).toHaveLength(1);
      expect(merged.id).toBe('PIT-001');
    });

    it('should detect duplicate pitfall by title substring after normalization', () => {
      store.save({
        id: 'PIT-010', type: 'pitfall', title: '[Analyst] API 超时导致请求失败',
        content: 'some content here that is long enough for prefix comparison purposes and more',
        maturity: 'draft', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [],
        executionResults: [],
      consumptionMode: 'reference',
      origin: 'agent',
      });

      // After stripping [prefix], normalizing: "api超时导致请求失败" contains "api超时导致"
      ingest.ingestEntry(
        { title: '[Triage Fix] API 超时导致', content: 'different content but same issue', type: 'pitfall' },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['pitfall'] })).toHaveLength(1);
    });

    it('should NOT merge pitfall entries with different root causes', () => {
      store.save({
        id: 'PIT-020', type: 'pitfall', title: '端口不匹配导致事件处理失败',
        content: '根因：events-daemon 默认使用 3001 端口连接 API，但实际 API 运行在 13101 端口。',
        maturity: 'draft', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [],
        executionResults: [],
      consumptionMode: 'reference',
      origin: 'agent',
      });

      // Completely different root cause → should NOT merge
      ingest.ingestEntry(
        { title: '数据库连接池耗尽', content: '根因：连接池大小为 10，高并发时全部占满。', type: 'pitfall' },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['pitfall'] })).toHaveLength(2);
    });

    it('正文首行以 --- 开头但不是 frontmatter 时不误吞分隔线（harness#89 回归）', () => {
      // 两条正文首行是 `--- 说明…`（不是整行 ---，故 absent），中间各有一条 --- 分隔线。
      // 收口前的手写 strip 把正文里那条 --- 当成闭合，吞掉前面的说明行，
      // 于是两条的 dedup 前缀都变成同一段尾巴 → 误判重复。
      const tail = '端口 3001 与 13101 不一致导致 session:archive 事件无法送达，责任归属是启动配置未校验端口。';
      store.save({
        id: 'PIT-091', type: 'pitfall', title: '甲乙丙丁子网掩码配置漂移一',
        content: `--- 说明：这一段以三个连字符开头，但它不是 frontmatter\n\n---\n\n${tail}\n`,
        maturity: 'draft', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [],
        executionResults: [],
        consumptionMode: 'reference',
        origin: 'agent',
      });

      ingest.ingestEntry(
        {
          title: '戊己庚辛存储配额阈值设定二',
          content: `--- 另一段同样以三个连字符开头的说明文字，形态与上面完全对称\n\n---\n\n${tail}\n`,
          type: 'pitfall',
        },
        { source: 'test', layer: 'system' },
      );

      expect(store.list({ types: ['pitfall'] })).toHaveLength(2);
    });

    it('should detect duplicate by title keyword overlap >= 60%', () => {
      store.save({
        id: 'PIT-030', type: 'pitfall', title: 'Prisma 连接超时导致 API 请求失败',
        content: 'Some content about Prisma connection timeout issues',
        maturity: 'draft', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [], executionResults: [],
      consumptionMode: 'reference',
      origin: 'agent',
      });

      // Keywords: prisma, 连接, 超时, 导致, api, 请求, 失败
      // Incoming: prisma, 超时, 请求, 失败 → 4/7 overlap
      ingest.ingestEntry(
        { title: 'Prisma 超时导致请求失败', content: 'totally different content', type: 'pitfall' },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['pitfall'] })).toHaveLength(1);
    });

    it('should apply semantic dedup to non-pitfall types', () => {
      store.save({
        id: 'GUI-001', type: 'guideline', title: 'events-daemon 端口不匹配导致事件处理失败',
        content: '根因：events-daemon 默认使用 3001 端口连接 API',
        maturity: 'draft', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [], executionResults: [],
      consumptionMode: 'reference',
      origin: 'agent',
      });

      // Title substring match (>= 6 chars) — should detect as duplicate
      ingest.ingestEntry(
        { title: 'events-daemon 端口不匹配', content: 'shorter title', type: 'guideline' },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['guideline'] })).toHaveLength(1);
    });
  });

  describe('audit quality gate', () => {
    it('should archive entry with test-scope tags', () => {
      ingest.ingestEntry(
        { title: 'TestEntry', type: 'guideline', tags: ['test-scope-abc'], content: 'real content here' },
        { source: 'test', layer: 'project' },
      );
      const saved = store.list({ excludeArchived: false });
      expect(saved).toHaveLength(1);
      expect(saved[0].maturity).toBe('archived');
    });

    it('should demote zero-content proven entry to draft', () => {
      ingest.ingestEntry(
        { title: 'ZeroProven', type: 'guideline', content: 'tiny', maturity: 'proven' as any },
        { source: 'test', layer: 'project' },
      );
      const saved = store.list({ excludeArchived: false });
      expect(saved).toHaveLength(1);
      expect(saved[0].maturity).toBe('draft');
    });

    it('should skip demote when options.maturity is explicitly set', () => {
      ingest.ingestEntry(
        { title: 'ExplicitMaturity', type: 'guideline', content: 'tiny' },
        { source: 'test', layer: 'project', maturity: 'verified' },
      );
      const saved = store.list({ excludeArchived: false });
      expect(saved).toHaveLength(1);
      // Should stay verified — audit demote skipped because maturity was explicit
      expect(saved[0].maturity).toBe('verified');
    });

    it('should flag short-content entry with low_quality tag', () => {
      ingest.ingestEntry(
        { title: 'ShortContent', type: 'guideline', content: 'a'.repeat(30) },
        { source: 'test', layer: 'project' },
      );
      const saved = store.list({ excludeArchived: false });
      expect(saved).toHaveLength(1);
      expect(saved[0].tags).toContain('low_quality');
    });
  });

  describe('edge cases', () => {
    it('should default to guideline type when type is not provided', () => {
      const { entry } = ingest.ingestEntry(
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
      const { entry: merged } = ingest.ingestEntry(
        { title: 'my decision', type: 'decision', content: 'updated' },
        { source: 'test', layer: 'project' },
      );
      expect(merged.content).toBe('updated');
      expect(store.list()).toHaveLength(1);
    });
  });

});
