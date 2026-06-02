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
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KnowledgeAudit } from '../audit';
import { KnowledgeStore } from '../store';
import type { KnowledgeEntry } from '../types';

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
    ...overrides,
  };
}

function setupStore(dir: string, entries: Partial<KnowledgeEntry>[]): KnowledgeStore {
  const store = new KnowledgeStore({ baseDir: dir });
  for (const partial of entries) {
    const entry = makeEntry(partial);
    store.save(entry);
  }
  return store;
}

// ── D1: frontmatter-missing ─────────────────────────────

describe('D1: frontmatter-missing', () => {
  it('rejects entry with missing id', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ id: '' as any });
    const issues = audit.validate(entry);
    const fm = issues.filter(i => i.rule === 'frontmatter-missing');
    expect(fm.length).toBe(1);
    expect(fm[0].action).toBe('reject');
    fs.rmSync(dir, { recursive: true });
  });

  it('rejects entry with missing type', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ type: undefined as any });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'frontmatter-missing')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('passes with all required fields present', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry();
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'frontmatter-missing')).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D2: test-data-pollution ─────────────────────────────

describe('D2: test-data-pollution', () => {
  it('archives entries with test-scope tags', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ tags: ['test-scope-abc'] });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'test-data-pollution' && i.action === 'archive')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('archives entries with test title', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ title: 'Test Entry' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'test-data-pollution')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('archives entries with test-* ID', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ id: 'test-search-1780414709970-pattern' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'test-data-pollution' && i.detail.includes('test-search'))).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('archives entries with inj-test-* ID', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ id: 'inj-test-1780414711344' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'test-data-pollution' && i.detail.includes('inj-test'))).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('skips archived entries', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ maturity: 'archived', tags: ['test-scope-abc'] });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'test-data-pollution')).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D2: daily-audit-noise ──────────────────────────────

describe('D2: daily-audit-noise', () => {
  it('archives entries with [Auditor] Daily audit title', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ title: '[Auditor] Daily audit 2026-06-01' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'daily-audit-noise' && i.action === 'archive')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('passes for normal titles', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ title: 'Normal knowledge entry' });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'daily-audit-noise')).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D2: event-noise ────────────────────────────────────

describe('D2: event-noise', () => {
  it('rejects [Monitor] event titles', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ title: '[Monitor] stuck_goals: GoalExecution abc123' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'event-noise' && i.action === 'archive')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('rejects KnowledgeSync cycle titles', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ title: 'KnowledgeSync cycle: 0 stale, 0 unmonitored' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'event-noise' && i.action === 'archive')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('rejects [Triage Fix] titles', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ title: '[Triage Fix] timeout (critical)' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'event-noise' && i.action === 'archive')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('rejects [Session Feature] titles', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ title: '[Session Feature] feat: studio release' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'event-noise' && i.action === 'archive')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('passes for normal knowledge titles', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ title: 'SQLite WAL mode pattern' });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'event-noise')).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });

  it('skips archived entries', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ maturity: 'archived', title: '[Monitor] stuck_goals: test' });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'event-noise')).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D2: zero-content-proven ────────────────────────────

describe('D2: zero-content-proven', () => {
  it('demotes proven entries with <20 chars content', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ maturity: 'proven', content: 'short' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'zero-content-proven' && i.action === 'demote')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('passes for proven entries with sufficient content', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ maturity: 'proven', content: 'a'.repeat(50) });
    const issues = audit.validate(entry);
    expect(issues.filter(i => i.rule === 'zero-content-proven')).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D2: maturity-inflation ─────────────────────────────

describe('D2: maturity-inflation', () => {
  it('demotes verified entries with <20 chars content', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    const entry = makeEntry({ maturity: 'verified', content: 'tiny' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'maturity-inflation' && i.action === 'demote')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D2: short-content ──────────────────────────────────

describe('D2: short-content', () => {
  it('flags entries with content between 20-50 chars', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
    // 25 chars — above zero threshold (20) but below short threshold (50)
    const entry = makeEntry({ content: 'a'.repeat(25), maturity: 'draft' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'short-content' && i.action === 'flag')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('respects custom threshold', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir, shortContentThreshold: 100 });
    const entry = makeEntry({ content: 'a'.repeat(60), maturity: 'draft' });
    const issues = audit.validate(entry);
    expect(issues.some(i => i.rule === 'short-content')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D3: title-duplicate ────────────────────────────────

describe('D3: title-duplicate', () => {
  it('flags entries with duplicate titles of same type', () => {
    const dir = makeTmpDir();
    setupStore(dir, [
      { id: 'A-001', title: 'Same Title', type: 'guideline' },
      { id: 'A-002', title: 'Same Title', type: 'guideline' },
    ]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    const dupes = report.issues.filter(i => i.rule === 'title-duplicate');
    expect(dupes.length).toBe(2);
    fs.rmSync(dir, { recursive: true });
  });

  it('ignores archived entries in dedup', () => {
    const dir = makeTmpDir();
    setupStore(dir, [
      { id: 'A-001', title: 'Same Title', type: 'guideline', maturity: 'archived' },
      { id: 'A-002', title: 'Same Title', type: 'guideline' },
    ]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    const dupes = report.issues.filter(i => i.rule === 'title-duplicate');
    expect(dupes.length).toBe(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D3: source-refs-bloat ──────────────────────────────

describe('D3: source-refs-bloat', () => {
  it('flags entries with >20 source references', () => {
    const dir = makeTmpDir();
    const refs = Array.from({ length: 25 }, (_, i) => ({
      workflow: `wf-${i}`,
      timestamp: new Date().toISOString(),
    }));
    setupStore(dir, [{ id: 'B-001', sourceReferences: refs }]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    expect(report.issues.some(i => i.rule === 'source-refs-bloat')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('trims source references on auto-fix', () => {
    const dir = makeTmpDir();
    const refs = Array.from({ length: 25 }, (_, i) => ({
      workflow: `wf-${i}`,
      timestamp: new Date().toISOString(),
    }));
    setupStore(dir, [{ id: 'B-001', sourceReferences: refs, title: 'Valid Knowledge Title' }]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run({ autoFix: true });
    expect(report.autoFixed).toBeGreaterThan(0);
    // re-read from disk after fix
    const store2 = new KnowledgeStore({ baseDir: dir });
    const updated = store2.get('B-001');
    expect(updated!.sourceReferences.length).toBe(20);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D4: promotion-blocked ──────────────────────────────

describe('D4: promotion-blocked', () => {
  it('flags draft entries older than 30 days with no references', () => {
    const dir = makeTmpDir();
    const oldDate = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
    setupStore(dir, [{
      id: 'C-001',
      maturity: 'draft',
      created: oldDate,
      lastReferenced: '',
    }]);
    const audit = new KnowledgeAudit({ baseDir: dir, promotionBlockDays: 30 });
    const report = audit.run();
    expect(report.issues.some(i => i.rule === 'promotion-blocked')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('ignores non-draft entries', () => {
    const dir = makeTmpDir();
    const oldDate = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
    setupStore(dir, [{
      id: 'C-002',
      maturity: 'verified',
      created: oldDate,
      lastReferenced: '',
    }]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    expect(report.issues.filter(i => i.rule === 'promotion-blocked')).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D4: orphan-draft ───────────────────────────────────

describe('D4: orphan-draft', () => {
  it('flags drafts with no contributors/projects/references', () => {
    const dir = makeTmpDir();
    setupStore(dir, [{
      id: 'D-001',
      maturity: 'draft',
      contributors: [],
      projects: [],
      referencedBy: [],
    }]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    expect(report.issues.some(i => i.rule === 'orphan-draft')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('passes for drafts with contributors', () => {
    const dir = makeTmpDir();
    setupStore(dir, [{
      id: 'D-002',
      maturity: 'draft',
      contributors: ['user-a'],
      projects: [],
      referencedBy: [],
    }]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    expect(report.issues.filter(i => i.rule === 'orphan-draft')).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D5: stale-entry ────────────────────────────────────

describe('D5: stale-entry', () => {
  it('flags entries older than staleDays threshold', () => {
    const dir = makeTmpDir();
    const oldDate = new Date(Date.now() - 120 * 24 * 3600_000).toISOString();
    setupStore(dir, [{
      id: 'E-001',
      maturity: 'verified',
      lastReferenced: oldDate,
    }]);
    const audit = new KnowledgeAudit({ baseDir: dir, staleDays: 90 });
    const report = audit.run();
    expect(report.issues.some(i => i.rule === 'stale-entry')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('ignores archived entries', () => {
    const dir = makeTmpDir();
    const oldDate = new Date(Date.now() - 120 * 24 * 3600_000).toISOString();
    setupStore(dir, [{
      id: 'E-002',
      maturity: 'archived',
      lastReferenced: oldDate,
    }]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    expect(report.issues.filter(i => i.rule === 'stale-entry')).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── D6: flywheel dimension ─────────────────────────────

describe('D6: flywheel dimension', () => {
  it('computes refCoverage from referencedBy', () => {
    const dir = makeTmpDir();
    setupStore(dir, [
      { id: 'F-001', maturity: 'verified', referencedBy: ['agent-1', 'agent-2'] },
      { id: 'F-002', maturity: 'verified', referencedBy: [] },
      { id: 'F-003', maturity: 'verified', referencedBy: ['agent-1'] },
    ]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    // 2/3 entries have refs → 67% coverage
    expect(report.dimensions.flywheel.details.refCoverage).toBe(67);
    expect(report.dimensions.flywheel.score).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true });
  });

  it('gives 0 score for empty store (no entries to measure)', () => {
    const dir = makeTmpDir();
    const audit = new KnowledgeAudit({ baseDir: dir });
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
    const audit1 = new KnowledgeAudit({ baseDir: dir });
    const report1 = audit1.run();
    const baseD6 = report1.dimensions.flywheel.score;

    // Write consumption stats file
    fs.writeFileSync(
      path.join(dir, '.consumption-stats.json'),
      JSON.stringify({ date: '2026-06-02', dailyEvents: 10, searchHits: 5 }),
    );

    // With consumption stats → higher D6
    const audit2 = new KnowledgeAudit({ baseDir: dir });
    const report2 = audit2.run();
    expect(report2.dimensions.flywheel.score).toBeGreaterThan(baseD6);
    expect(report2.dimensions.flywheel.details.dailyConsumptionEvents).toBe(10);

    fs.rmSync(dir, { recursive: true });
  });
});

// ── Health score ────────────────────────────────────────

describe('health score', () => {
  it('returns 100 for clean store', () => {
    const dir = makeTmpDir();
    setupStore(dir, [
      { id: 'G-001', maturity: 'verified', content: 'a'.repeat(100), title: 'Unique Title A' },
      { id: 'G-002', maturity: 'proven', content: 'b'.repeat(100), title: 'Unique Title B' },
    ]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    expect(report.healthScore.before).toBe(100);
    fs.rmSync(dir, { recursive: true });
  });

  it('decreases with critical issues', () => {
    const dir = makeTmpDir();
    setupStore(dir, [
      { id: 'G-003', maturity: 'proven', content: 'tiny', title: 'Test Entry' },
    ]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    expect(report.healthScore.before).toBeLessThan(100);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── Auto-fix ────────────────────────────────────────────

describe('auto-fix', () => {
  it('archives test data entries', () => {
    const dir = makeTmpDir();
    const store = setupStore(dir, [
      { id: 'H-001', tags: ['test-scope-abc'], maturity: 'verified' },
    ]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run({ autoFix: true });
    expect(report.autoFixed).toBeGreaterThan(0);
    expect(store.get('H-001')!.maturity).toBe('archived');
    fs.rmSync(dir, { recursive: true });
  });

  it('demotes zero-content proven entries', () => {
    const dir = makeTmpDir();
    const store = setupStore(dir, [
      { id: 'H-002', maturity: 'proven', content: 'tiny', title: 'Normal Title' },
    ]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    audit.run({ autoFix: true });
    expect(store.get('H-002')!.maturity).toBe('draft');
    fs.rmSync(dir, { recursive: true });
  });

  it('flags short content entries with low_quality tag', () => {
    const dir = makeTmpDir();
    const store = setupStore(dir, [
      { id: 'H-003', maturity: 'draft', content: 'a'.repeat(30), title: 'Normal Title 2' },
    ]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    audit.run({ autoFix: true });
    expect(store.get('H-003')!.tags).toContain('low_quality');
    fs.rmSync(dir, { recursive: true });
  });
});

// ── run() report structure ─────────────────────────────

describe('run() report', () => {
  it('returns correct report structure', () => {
    const dir = makeTmpDir();
    setupStore(dir, [{ id: 'I-001' }]);
    const audit = new KnowledgeAudit({ baseDir: dir });
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
    fs.rmSync(dir, { recursive: true });
  });

  it('summary counts match issue counts', () => {
    const dir = makeTmpDir();
    setupStore(dir, [
      { id: 'I-002', title: 'Test Entry', maturity: 'proven', content: 'tiny' },
    ]);
    const audit = new KnowledgeAudit({ baseDir: dir });
    const report = audit.run();
    const totalFromSummary = Object.values(report.summary).reduce((a, b) => a + b, 0);
    expect(totalFromSummary).toBe(report.issues.length);
    fs.rmSync(dir, { recursive: true });
  });
});
