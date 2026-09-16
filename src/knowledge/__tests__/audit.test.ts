/**
 * KnowledgeAudit tests
 *
 * Covers all 11 rules across 6 dimensions:
 * D1: frontmatter-missing
 * D2: test-data-pollution, daily-audit-noise, event-noise, zero-content-proven, short-content, maturity-inflation
 * D3: title-duplicate, source-refs-bloat
 * D4: promotion-blocked, orphan-draft
 * D5: stale-entry
 * D6: flywheel (computed from referencedBy)
 *
 * 构造收 store（harness#134）：打分离开文件系统即可测——本文件除了「修复动作是否真落盘」
 * 那几条用真 FileKnowledgeStore（落盘可见性就是它的判定面），其余全部走内存 store 双。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KnowledgeAudit } from '../audit';
import { FileKnowledgeStore } from '../store';
import type { KnowledgeStore } from '../store';
import type {
  ConsumptionStats,
  IndexEntry,
  KnowledgeEntry,
  QueryFilter,
  SnapshotSurvival,
  StoreUpdate,
} from '../types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
}

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'TEST-001',
    type: 'guideline',
    title: 'Test Entry',
    content: 'Some meaningful content that is long enough to pass thresholds',
    maturity: 'draft',
    layer: 'project',
    created: new Date().toISOString(),
    lastReferenced: new Date().toISOString(),
    contributors: ['test-user'],
    projects: ['test-project'],
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

/**
 * 内存 store 双：只服务 audit 的取数形状（list / get / applyAll / 环境数据），
 * 与 FileKnowledgeStore 同实现 KnowledgeStore 接口——接口变动即编译期报错。
 */
class MemoryKnowledgeStore implements KnowledgeStore {
  private entries = new Map<string, KnowledgeEntry>();
  consumptionStats?: ConsumptionStats;
  survival?: SnapshotSurvival;
  applyAllCalls = 0;

  constructor(entries: KnowledgeEntry[] = []) {
    for (const e of entries) this.entries.set(e.id, e);
  }

  getBaseDir(): string { return 'memory://knowledge'; }
  get(id: string): KnowledgeEntry | undefined { return this.entries.get(id); }

  list(filter?: QueryFilter): KnowledgeEntry[] {
    const all = [...this.entries.values()];
    if (filter?.excludeArchived === false) return all;
    return all.filter(e => e.maturity !== 'archived' && e.maturity !== 'deprecated');
  }

  save(entry: KnowledgeEntry): void { this.entries.set(entry.id, entry); }
  saveAll(entries: KnowledgeEntry[]): void { for (const e of entries) this.save(e); }
  applyAll(updates: StoreUpdate[]): void {
    if (updates.length === 0) return; // 接口契约：空批零读写（真实现由 store.test.ts 钉住）
    this.applyAllCalls++;
    for (const { id, partial } of updates) {
      const existing = this.entries.get(id);
      if (existing) this.entries.set(id, { ...existing, ...partial, id });
    }
  }
  delete(id: string): boolean { return this.entries.delete(id); }
  update(id: string, partial: Partial<KnowledgeEntry>): KnowledgeEntry | undefined {
    const existing = this.entries.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...partial, id };
    this.entries.set(id, updated);
    return updated;
  }
  rebuildIndex(): void { /* 内存双无索引 */ }
  readIndex(): IndexEntry[] { return []; }
  readEntriesFromDisk(): KnowledgeEntry[] { return this.list({ excludeArchived: false }); }
  snapshot(): string { return 'memory://knowledge/.snapshots'; }
  getSnapshot(): IndexEntry[] | undefined { return undefined; }
  getSurvivalRate(): SnapshotSurvival | undefined { return this.survival; }
  getConsumptionStats(): ConsumptionStats | undefined { return this.consumptionStats; }
}

function setupStore(dir: string, entries: Partial<KnowledgeEntry>[]): FileKnowledgeStore {
  const store = new FileKnowledgeStore({ baseDir: dir });
  for (const partial of entries) {
    const entry = makeEntry(partial);
    store.save(entry);
  }
  return store;
}

/** 打分用例的共用形状：内存 store + 已落条目 + 阈值 */
function memoryAudit(
  entries: KnowledgeEntry[],
  options?: { shortContentThreshold?: number; staleDays?: number; promotionBlockDays?: number }
): { audit: KnowledgeAudit; store: MemoryKnowledgeStore } {
  const store = new MemoryKnowledgeStore(entries);
  return { audit: new KnowledgeAudit(store, options), store };
}

// ── D1: frontmatter-missing ─────────────────────────────

describe('D1: frontmatter-missing', () => {
  it('rejects entry with missing id', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ id: '' as any });
    const issues = audit.validate(entry);
    const fm = issues.filter(i => i.rule === 'frontmatter-missing');
    expect(fm.length).toBe(1);
    expect(fm[0].action).toBe('reject');
  });

  it('rejects entry with missing type', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ type: undefined as any });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'frontmatter-missing')).toBe(true);
  });

  it('passes with all required fields present', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry();
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'frontmatter-missing')).toHaveLength(0);
  });
});

// ── D2: test-data-pollution ─────────────────────────────

describe('D2: test-data-pollution', () => {
  it('archives entries with test-scope tags', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ tags: ['test-scope-abc'] });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'test-data-pollution' && i.action === 'archive')).toBe(true);
  });

  it('archives entries with test title', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: 'Test Entry' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'test-data-pollution')).toBe(true);
  });

  it('archives entries with test-* ID', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ id: 'test-search-1780414709970-pattern' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'test-data-pollution' && i.detail.includes('test-search'))).toBe(true);
  });

  it('archives entries with inj-test-* ID', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ id: 'inj-test-1780414711344' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'test-data-pollution' && i.detail.includes('inj-test'))).toBe(true);
  });

  it('skips archived entries', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ maturity: 'archived', tags: ['test-scope-abc'] });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'test-data-pollution')).toHaveLength(0);
  });
});

// ── D2: daily-audit-noise ──────────────────────────────

describe('D2: daily-audit-noise', () => {
  it('archives entries with [Auditor] Daily audit title', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: '[Auditor] Daily audit 2026-06-01' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'daily-audit-noise' && i.action === 'archive')).toBe(true);
  });

  it('passes for normal titles', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: 'Normal knowledge entry' });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'daily-audit-noise')).toHaveLength(0);
  });
});

// ── D2: event-noise ────────────────────────────────────

describe('D2: event-noise', () => {
  it('rejects [Monitor] event titles', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: '[Monitor] stuck_goals: GoalExecution abc123' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'event-noise' && i.action === 'archive')).toBe(true);
  });

  it('rejects KnowledgeSync cycle titles', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: 'KnowledgeSync cycle: 0 stale, 0 unmonitored' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'event-noise' && i.action === 'archive')).toBe(true);
  });

  it('rejects [Triage Fix] titles', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: '[Triage Fix] timeout (critical)' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'event-noise' && i.action === 'archive')).toBe(true);
  });

  it('rejects [Session Feature] titles', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: '[Session Feature] feat: studio release' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'event-noise' && i.action === 'archive')).toBe(true);
  });

  it('passes for normal knowledge titles', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: 'SQLite WAL mode pattern' });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'event-noise')).toHaveLength(0);
  });

  it('skips archived entries', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ maturity: 'archived', title: '[Monitor] stuck_goals: test' });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'event-noise')).toHaveLength(0);
  });
});

// ── D2: zero-content-proven ────────────────────────────

describe('D2: zero-content-proven', () => {
  it('demotes proven entries with <20 chars content', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ maturity: 'proven', content: 'short' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'zero-content-proven' && i.action === 'demote')).toBe(true);
  });

  it('passes for proven entries with sufficient content', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ maturity: 'proven', content: 'a'.repeat(50) });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'zero-content-proven')).toHaveLength(0);
  });
});

// ── D2: maturity-inflation ─────────────────────────────

describe('D2: maturity-inflation', () => {
  it('demotes verified entries with <20 chars content', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ maturity: 'verified', content: 'tiny' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'maturity-inflation' && i.action === 'demote')).toBe(true);
  });
});

// ── D2: short-content ──────────────────────────────────

describe('D2: short-content', () => {
  it('flags entries with content between 20-50 chars', () => {
    const { audit } = memoryAudit([]);
    // 25 chars — above zero threshold (20) but below short threshold (50)
    const entry = makeEntry({ content: 'a'.repeat(25), maturity: 'draft' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'short-content' && i.action === 'flag')).toBe(true);
  });

  it('respects custom threshold', () => {
    const { audit } = memoryAudit([], { shortContentThreshold: 100 });
    const entry = makeEntry({ content: 'a'.repeat(60), maturity: 'draft' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'short-content')).toBe(true);
  });
});

// ── D3: title-duplicate ────────────────────────────────

describe('D3: title-duplicate', () => {
  it('flags entries with duplicate titles of same type', () => {
    const { audit } = memoryAudit([
      makeEntry({ id: 'A-001', title: 'Same Title', type: 'guideline' }),
      makeEntry({ id: 'A-002', title: 'Same Title', type: 'guideline' }),
    ]);
    const report = audit.run();
    const dupes = report.issues.filter(i => i.rule === 'title-duplicate');
    expect(dupes.length).toBe(2);
  });

  it('ignores archived entries in dedup', () => {
    const { audit } = memoryAudit([
      makeEntry({ id: 'A-001', title: 'Same Title', type: 'guideline', maturity: 'archived' }),
      makeEntry({ id: 'A-002', title: 'Same Title', type: 'guideline' }),
    ]);
    const report = audit.run();
    const dupes = report.issues.filter(i => i.rule === 'title-duplicate');
    expect(dupes.length).toBe(0);
  });
});

// ── D3: source-refs-bloat ──────────────────────────────

describe('D3: source-refs-bloat', () => {
  const bloatRefs = () => Array.from({ length: 25 }, (_, i) => ({
    workflow: `wf-${i}`,
    timestamp: new Date().toISOString(),
  }));

  it('flags entries with >20 source references', () => {
    const { audit } = memoryAudit([makeEntry({ id: 'B-001', sourceReferences: bloatRefs() })]);
    const report = audit.run();
    expect(report.issues.some(i => i.rule === 'source-refs-bloat')).toBe(true);
  });

  it('trims source references on auto-fix', () => {
    const dir = makeTmpDir();
    setupStore(dir, [{ id: 'B-001', sourceReferences: bloatRefs(), title: 'Valid Knowledge Title' }]);
    const store = new FileKnowledgeStore({ baseDir: dir });
    const audit = new KnowledgeAudit(store);
    const report = audit.run({ autoFix: true });
    expect(report.autoFixed).toBeGreaterThan(0);
    // re-read from disk after fix
    const store2 = new FileKnowledgeStore({ baseDir: dir });
    const updated = store2.get('B-001');
    expect(updated!.sourceReferences.length).toBe(20);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D4: promotion-blocked ──────────────────────────────

describe('D4: promotion-blocked', () => {
  it('flags draft entries older than 30 days with no references', () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
    const { audit } = memoryAudit(
      [makeEntry({ id: 'C-001', maturity: 'draft', created: oldDate, lastReferenced: '' })],
      { promotionBlockDays: 30 }
    );
    const report = audit.run();
    expect(report.issues.some(i => i.rule === 'promotion-blocked')).toBe(true);
  });

  it('ignores non-draft entries', () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
    const { audit } = memoryAudit([
      makeEntry({ id: 'C-002', maturity: 'verified', created: oldDate, lastReferenced: '' }),
    ]);
    const report = audit.run();
    expect(report.issues.filter(i => i.rule === 'promotion-blocked')).toHaveLength(0);
  });
});

// ── D4: orphan-draft ───────────────────────────────────

describe('D4: orphan-draft', () => {
  it('flags drafts with no contributors/projects/references', () => {
    const { audit } = memoryAudit([
      makeEntry({ id: 'D-001', maturity: 'draft', contributors: [], projects: [], referencedBy: [] }),
    ]);
    const report = audit.run();
    expect(report.issues.some(i => i.rule === 'orphan-draft')).toBe(true);
  });

  it('passes for drafts with contributors', () => {
    const { audit } = memoryAudit([
      makeEntry({ id: 'D-002', maturity: 'draft', contributors: ['user-a'], projects: [], referencedBy: [] }),
    ]);
    const report = audit.run();
    expect(report.issues.filter(i => i.rule === 'orphan-draft')).toHaveLength(0);
  });
});

// ── D5: stale-entry ────────────────────────────────────

describe('D5: stale-entry', () => {
  it('flags entries older than staleDays threshold', () => {
    const oldDate = new Date(Date.now() - 120 * 24 * 3600_000).toISOString();
    const { audit } = memoryAudit(
      [makeEntry({ id: 'E-001', maturity: 'verified', lastReferenced: oldDate })],
      { staleDays: 90 }
    );
    const report = audit.run();
    expect(report.issues.some(i => i.rule === 'stale-entry')).toBe(true);
  });

  it('ignores archived entries', () => {
    const oldDate = new Date(Date.now() - 120 * 24 * 3600_000).toISOString();
    const { audit } = memoryAudit([
      makeEntry({ id: 'E-002', maturity: 'archived', lastReferenced: oldDate }),
    ]);
    const report = audit.run();
    expect(report.issues.filter(i => i.rule === 'stale-entry')).toHaveLength(0);
  });
});

// ── D6: flywheel dimension ─────────────────────────────

describe('D6: flywheel dimension', () => {
  it('computes refCoverage from referencedBy', () => {
    const { audit } = memoryAudit([
      makeEntry({ id: 'F-001', maturity: 'verified', referencedBy: ['agent-1', 'agent-2'] }),
      makeEntry({ id: 'F-002', maturity: 'verified', referencedBy: [] }),
      makeEntry({ id: 'F-003', maturity: 'verified', referencedBy: ['agent-1'] }),
    ]);
    const report = audit.run();
    // 2/3 entries have refs → 67% coverage
    expect(report.dimensions.flywheel.details.refCoverage).toBe(67);
    expect(report.dimensions.flywheel.score).toBeGreaterThan(0);
  });

  it('gives 0 score for empty store (no entries to measure)', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit(new FileKnowledgeStore({ baseDir: dir }));
    const report = audit.run();
    // 0/0 = no data → score 0 (no flywheel activity)
    expect(report.dimensions.flywheel.score).toBe(0);
    expect(report.totalEntries).toBe(0);
    fs.rmSync(dir, { recursive: true });
  });

  it('boosts D6 score when consumption stats file exists', () => {
    const dir = makeTmpDir();
    setupStore(dir, [
      { id: 'F-001', maturity: 'verified', referencedBy: [] },
      { id: 'F-002', maturity: 'verified', referencedBy: [] },
    ]);

    // Without consumption stats → low D6 (no refs)
    const audit1 = new KnowledgeAudit(new FileKnowledgeStore({ baseDir: dir }));
    const report1 = audit1.run();
    const baseD6 = report1.dimensions.flywheel.score;

    // Write consumption stats file
    fs.writeFileSync(
      path.join(dir, '.consumption-stats.json'),
      JSON.stringify({ date: '2026-06-02', dailyEvents: 10, searchHits: 5 }),
    );

    // With consumption stats → higher D6（取数口是 store.getConsumptionStats，#134）
    const audit2 = new KnowledgeAudit(new FileKnowledgeStore({ baseDir: dir }));
    const report2 = audit2.run();
    expect(report2.dimensions.flywheel.score).toBeGreaterThan(baseD6);
    expect(report2.dimensions.flywheel.details.dailyConsumptionEvents).toBe(10);

    fs.rmSync(dir, { recursive: true });
  });
});

// ── D7: incremental dimension ──────────────────────────

describe('D7: incremental dimension（环境数据经 store 供给，#134）', () => {
  it('无可用快照 → 满分并说明无数据', () => {
    const { audit } = memoryAudit([makeEntry({ id: 'S-001', maturity: 'verified' })]);
    const report = audit.run();
    expect(report.dimensions.incremental).toEqual({
      score: 100,
      issues: 0,
      details: { note: 'no 30d snapshot available' },
    });
  });

  it('有 30 天快照 → 分数即存活率，问题数即流失数', () => {
    const { audit, store } = memoryAudit([makeEntry({ id: 'S-001', maturity: 'verified' })]);
    store.survival = { rate: 75, survived: 3, total: 4, snapshotDate: '2026-08-15' };
    const report = audit.run();
    expect(report.dimensions.incremental).toEqual({
      score: 75,
      issues: 1,
      details: { survivalRate: 75, survived: 3, total: 4, snapshotDate: '2026-08-15' },
    });
  });
});

// ── Health score ────────────────────────────────────────

describe('health score', () => {
  it('returns 100 for clean store', () => {
    const { audit } = memoryAudit([
      makeEntry({ id: 'G-001', maturity: 'verified', content: 'a'.repeat(100), title: 'Unique Title A' }),
      makeEntry({ id: 'G-002', maturity: 'proven', content: 'b'.repeat(100), title: 'Unique Title B' }),
    ]);
    const report = audit.run();
    expect(report.healthScore.before).toBe(100);
  });

  it('decreases with critical issues', () => {
    const { audit } = memoryAudit([
      makeEntry({ id: 'G-003', maturity: 'proven', content: 'tiny', title: 'Test Entry' }),
    ]);
    const report = audit.run();
    expect(report.healthScore.before).toBeLessThan(100);
  });
});

// ── Auto-fix ────────────────────────────────────────────

describe('auto-fix', () => {
  it('archives test data entries', () => {
    const { audit, store } = memoryAudit([
      makeEntry({ id: 'H-001', tags: ['test-scope-abc'], maturity: 'verified' }),
    ]);
    const report = audit.run({ autoFix: true });
    expect(report.autoFixed).toBeGreaterThan(0);
    expect(store.get('H-001')!.maturity).toBe('archived');
  });

  it('demotes zero-content proven entries', () => {
    const { audit, store } = memoryAudit([
      makeEntry({ id: 'H-002', maturity: 'proven', content: 'tiny', title: 'Normal Title' }),
    ]);
    audit.run({ autoFix: true });
    expect(store.get('H-002')!.maturity).toBe('draft');
  });

  it('flags short content entries with low_quality tag', () => {
    const { audit, store } = memoryAudit([
      makeEntry({ id: 'H-003', maturity: 'draft', content: 'a'.repeat(30), title: 'Normal Title 2' }),
    ]);
    audit.run({ autoFix: true });
    expect(store.get('H-003')!.tags).toContain('low_quality');
  });

  it('整批修复走一次 applyAll（不再逐条 update）', () => {
    const { audit, store } = memoryAudit([
      makeEntry({ id: 'H-004', tags: ['test-scope-a'], maturity: 'verified', title: 'Noise One' }),
      makeEntry({ id: 'H-005', tags: ['test-scope-b'], maturity: 'verified', title: 'Noise Two' }),
      makeEntry({ id: 'H-006', tags: ['test-scope-c'], maturity: 'verified', title: 'Noise Three' }),
    ]);
    const report = audit.run({ autoFix: true });
    expect(report.autoFixed).toBe(3); // 正对照：3 条真修复
    expect(store.applyAllCalls).toBe(1);
  });

  it('无修复项时不触发批量写', () => {
    const { audit, store } = memoryAudit([
      makeEntry({ id: 'H-007', maturity: 'verified', content: 'a'.repeat(100), title: 'Clean Title' }),
    ]);
    const report = audit.run({ autoFix: true });
    expect(report.autoFixed).toBe(0);
    expect(store.applyAllCalls).toBe(0);
  });

  it('reject 类问题（frontmatter 缺失）只报告、不产生任何修复动作', () => {
    const { audit, store } = memoryAudit([
      makeEntry({ id: '' as any, maturity: 'verified', title: 'Blank Id Title' }),
    ]);
    const report = audit.run({ autoFix: true });
    expect(report.issues.some(i => i.action === 'reject')).toBe(true);
    expect(report.autoFixed).toBe(0);
    expect(store.applyAllCalls).toBe(0);
  });
});

// ── D2b: deprecated-domain ──────────────────────────────

describe('D2b: deprecated-domain', () => {
  it('flags entry with "pipeline" tag', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ tags: ['pipeline', 'deployment'] });
    const issues = audit.validate(entry);
    const dd = issues.filter(i => i.rule === 'deprecated-domain');
    expect(dd.length).toBe(1);
    expect(dd[0].action).toBe('archive');
    expect(dd[0].severity).toBe('high');
  });

  it('flags entry with "pipeline" in title', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: 'Pipeline 工作单元不可见导致协作效率低' });
    const issues = audit.validate(entry);
    const dd = issues.filter(i => i.rule === 'deprecated-domain');
    expect(dd.length).toBe(1);
  });

  it('flags entry with "管线" in title', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: 'B51 管线端到端验证常量与测试' });
    const issues = audit.validate(entry);
    const dd = issues.filter(i => i.rule === 'deprecated-domain');
    expect(dd.length).toBe(1);
  });

  it('does not flag entry without deprecated domain references', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: 'Agent Network 核心概念', tags: ['agent', 'architecture'] });
    const issues = audit.validate(entry);
    const dd = issues.filter(i => i.rule === 'deprecated-domain');
    expect(dd.length).toBe(0);
  });

  it('skips already archived entries', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ title: 'Pipeline legacy entry', maturity: 'archived', tags: ['pipeline'] });
    const issues = audit.validate(entry);
    const dd = issues.filter(i => i.rule === 'deprecated-domain');
    expect(dd.length).toBe(0);
  });
});

// ── 构造形状（harness#134 验收 3）───────────────────────

describe('构造收 store', () => {
  it('validate() 全程不碰存储（判定不依赖 fs）', () => {
    const forbidden = new Proxy({} as KnowledgeStore, {
      get(_target, prop) {
        throw new Error(`validate() 不该读存储（碰了 ${String(prop)}）`);
      },
    });
    const audit = new KnowledgeAudit(forbidden);
    const issues = audit.validate(makeEntry({ title: 'Normal knowledge entry' }));
    expect(Array.isArray(issues)).toBe(true);
  });

  it('与兄弟模块同形：lint / doctor / query / lifecycle / ingest 一样收 store', async () => {
    const dir = makeTmpDir();
    const store = setupStore(dir, [{ id: 'W-001', title: 'Wiring Entry' }]);
    const { KnowledgeLifecycle } = await import('../lifecycle');
    const { KnowledgeQuery } = await import('../query');
    expect(() => new KnowledgeAudit(store)).not.toThrow();
    expect(new KnowledgeAudit(store).run().totalEntries).toBe(1);
    // 兄弟模块的构造第一形参就是 store
    expect(new KnowledgeLifecycle(store)).toBeInstanceOf(KnowledgeLifecycle);
    expect(new KnowledgeQuery(store)).toBeInstanceOf(KnowledgeQuery);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── run() report structure ─────────────────────────────

describe('run() report', () => {
  it('returns correct report structure', () => {
    const { audit } = memoryAudit([makeEntry({ id: 'I-001' })]);
    const report = audit.run();
    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('totalEntries');
    expect(report).toHaveProperty('issues');
    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('dimensions');
    expect(report).toHaveProperty('autoFixed');
    expect(report).toHaveProperty('healthScore');
    expect(report.healthScore).toHaveProperty('before');
    expect(report.healthScore).toHaveProperty('after');
    expect(report.dimensions).toHaveProperty('structure');
    expect(report.dimensions).toHaveProperty('content');
    expect(report.dimensions).toHaveProperty('dedup');
    expect(report.dimensions).toHaveProperty('maturity');
    expect(report.dimensions).toHaveProperty('freshness');
    expect(report.dimensions).toHaveProperty('flywheel');
  });

  it('summary counts match issue counts', () => {
    const { audit } = memoryAudit([
      makeEntry({ id: 'I-002', title: 'Test Entry', maturity: 'proven', content: 'tiny' }),
    ]);
    const report = audit.run();
    const totalFromSummary = Object.values(report.summary).reduce((a, b) => a + b, 0);
    expect(totalFromSummary).toBe(report.issues.length);
  });
});

// ── 构造器数值槽守卫（harness#163）─────────────────────────
//
// 三个数值槽显式传入 NaN / ±Infinity / 负数时构造期抛 TypeError（含槽名与实参），
// 不再放行到打分层静默关掉 short-content / stale-entry / promotion-blocked 三条判定。
// 未传 / 显式 undefined → 缺省；显式 0 → 合法且按 0 生效（不被兜成缺省）。

describe('构造器数值槽守卫（harness#163）', () => {
  const slots = ['shortContentThreshold', 'staleDays', 'promotionBlockDays'] as const;
  const dirtyValues = [NaN, Infinity, -Infinity, -1];

  for (const slot of slots) {
    for (const value of dirtyValues) {
      it(`${slot} 显式传 ${String(value)} → 构造抛 TypeError，message 含槽名与实参`, () => {
        expect(() => memoryAudit([], { [slot]: value })).toThrow(TypeError);
        expect(() => memoryAudit([], { [slot]: value })).toThrow(new RegExp(`${slot}.*${String(value).replace(/[+-]/g, '\\$&')}`));
      });
    }
  }

  it('不传 options → 缺省生效（短内容阈值 50）', () => {
    const { audit } = memoryAudit([]);
    const entry = makeEntry({ content: 'a'.repeat(25), maturity: 'draft' });
    expect(audit.validate(entry).some(i => i.rule === 'short-content')).toBe(true);
  });

  it('显式 undefined → 与未传同果，走缺省', () => {
    const { audit } = memoryAudit([], { shortContentThreshold: undefined, staleDays: undefined, promotionBlockDays: undefined });
    const entry = makeEntry({ content: 'a'.repeat(25), maturity: 'draft' });
    expect(audit.validate(entry).some(i => i.rule === 'short-content')).toBe(true);
  });

  it('显式 0 → 合法且按 0 生效：short-content 不触发（不被兜回 50）', () => {
    const { audit } = memoryAudit([], { shortContentThreshold: 0 });
    const entry = makeEntry({ content: 'a'.repeat(25), maturity: 'draft' });
    expect(audit.validate(entry).some(i => i.rule === 'short-content')).toBe(false);
  });

  it('staleDays 显式 0 → 按 0 生效（昨天引用的条目即判 stale，不被兜回 90）', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { audit } = memoryAudit([], { staleDays: 0 });
    const entry = makeEntry({ lastReferenced: yesterday, maturity: 'proven' });
    expect(audit.validate(entry).some(i => i.rule === 'stale-entry')).toBe(true);
  });

  it('合法正有限值（含非整数）→ 行为不变', () => {
    const { audit } = memoryAudit([], { shortContentThreshold: 30.5 });
    expect(audit.validate(makeEntry({ content: 'a'.repeat(30), maturity: 'draft' })).some(i => i.rule === 'short-content')).toBe(true);
    expect(audit.validate(makeEntry({ content: 'a'.repeat(40), maturity: 'draft' })).some(i => i.rule === 'short-content')).toBe(false);
  });
});
