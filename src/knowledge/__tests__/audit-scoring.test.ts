/**
 * audit-scoring 纯模块测试（harness#134）
 *
 * 本模块的立身之本是**零 IO**：判定只吃条目数组与已取好的环境数据。
 * 因此这里既有行为断言，也有一道源形状闸——有人往打分核心塞回 fs，就跑红。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  AUDIT_RULE_LABELS,
  DEFAULT_PROMOTION_BLOCK_DAYS,
  DEFAULT_SHORT_CONTENT_THRESHOLD,
  DEFAULT_STALE_DAYS,
  MAX_SOURCE_REFS,
  calculateHealthScore,
  computeDimensions,
  resolveThresholds,
  scanEntries,
  summarizeIssues,
} from '../audit-scoring';
import type { AuditIssue } from '../audit-scoring';
import type { KnowledgeEntry } from '../types';

const SOURCE = fs.readFileSync(path.join(__dirname, '../audit-scoring.ts'), 'utf-8');

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'SCORE-001',
    type: 'guideline',
    title: 'Scoring Entry',
    content: 'Some meaningful content that is long enough to pass thresholds',
    maturity: 'draft',
    layer: 'project',
    created: new Date().toISOString(),
    lastReferenced: new Date().toISOString(),
    contributors: ['tester'],
    projects: ['probe'],
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

describe('源形状闸：打分核心零 IO', () => {
  it('不 import fs/path，也不直读 store 之外的任何东西', () => {
    expect(SOURCE).not.toMatch(/from '(node:)?fs'/);
    expect(SOURCE).not.toMatch(/from 'path'/);
    expect(SOURCE).not.toMatch(/\bfs\.(readFileSync|existsSync|writeFileSync|readdirSync)\b/);
    expect(SOURCE).not.toMatch(/new FileKnowledgeStore/);
  });

  it('条目集合外唯一的入参是 env（消费统计与存活率由调用方取好喂入）', () => {
    expect(SOURCE).toContain('env: AuditEnv');
    expect(SOURCE).toContain('dailyConsumptionEvents?: number');
  });
});

describe('resolveThresholds', () => {
  it('未给阈值时落三张缺省值', () => {
    expect(resolveThresholds()).toEqual({
      shortContentThreshold: DEFAULT_SHORT_CONTENT_THRESHOLD,
      staleDays: DEFAULT_STALE_DAYS,
      promotionBlockDays: DEFAULT_PROMOTION_BLOCK_DAYS,
    });
  });

  it('显式值原样生效（含 0 不被缺省兜掉）', () => {
    expect(resolveThresholds({ shortContentThreshold: 0, staleDays: 7 }).shortContentThreshold).toBe(0);
    expect(resolveThresholds({ staleDays: 7 }).staleDays).toBe(7);
  });
});

describe('scanEntries 的人口语义', () => {
  it('单条目模式（不传人口）下跨条目规则不判定', () => {
    const dupes = [
      makeEntry({ id: 'P-1', title: 'Same', type: 'guideline' }),
      makeEntry({ id: 'P-2', title: 'Same', type: 'guideline' }),
    ];
    for (const entry of dupes) {
      expect(scanEntries([entry], {}).some(i => i.rule === 'title-duplicate')).toBe(false);
    }
  });

  it('传入人口时同一对条目互相判重（两条都报）', () => {
    const dupes = [
      makeEntry({ id: 'P-1', title: 'Same', type: 'guideline' }),
      makeEntry({ id: 'P-2', title: 'Same', type: 'guideline' }),
    ];
    const issues = scanEntries(dupes, {}, dupes);
    expect(issues.filter(i => i.rule === 'title-duplicate')).toHaveLength(2);
  });

  it('人口与扫描集合可不同：autoFix 重扫沿用修复前人口的现状口径', () => {
    const before = [
      makeEntry({ id: 'Q-1', title: 'Dup', type: 'guideline' }),
      makeEntry({ id: 'Q-2', title: 'Dup', type: 'guideline' }),
    ];
    const after = before.map(e => ({ ...e, maturity: 'archived' as const }));
    // 扫描已归档的集合、对照未归档的人口：active 规则不判定 archived，故零问题
    expect(scanEntries(after, {}, before)).toHaveLength(0);
    // 对照集合同为已归档：同样零问题（人口过滤唯一落点在 ruleDetail）
    expect(scanEntries(after, {}, after)).toHaveLength(0);
  });
});

describe('summarizeIssues', () => {
  it('未命中的规则也出零值键，键集与 label 正本表一致', () => {
    const summary = summarizeIssues([]);
    expect(Object.keys(summary).sort()).toEqual(Object.keys(AUDIT_RULE_LABELS).sort());
    expect(Object.values(summary).every(n => n === 0)).toBe(true);
  });

  it('命中计数逐条累加', () => {
    const issues: AuditIssue[] = [
      { rule: 'short-content', entryId: 'a', title: 'A', severity: 'medium', action: 'flag', detail: '' },
      { rule: 'short-content', entryId: 'b', title: 'B', severity: 'medium', action: 'flag', detail: '' },
      { rule: 'event-noise', entryId: 'c', title: 'C', severity: 'critical', action: 'archive', detail: '' },
    ];
    const summary = summarizeIssues(issues);
    expect(summary['short-content']).toBe(2);
    expect(summary['event-noise']).toBe(1);
  });
});

describe('computeDimensions 的环境数据入参', () => {
  const active = [
    makeEntry({ id: 'D-1', maturity: 'verified', referencedBy: ['x:2026-09-01'] }),
    makeEntry({ id: 'D-2', maturity: 'verified' }),
  ];

  it('D6 消费事件数来自 env，透传到报告明细', () => {
    const withOut = computeDimensions(active, [], {});
    const withEnv = computeDimensions(active, [], { dailyConsumptionEvents: 8 });
    expect(withOut.flywheel.details.dailyConsumptionEvents).toBe(0);
    expect(withEnv.flywheel.details.dailyConsumptionEvents).toBe(8);
    expect(withEnv.flywheel.score).toBeGreaterThan(withOut.flywheel.score);
  });

  it('D7 由 env.survival 供给：无快照 = 满分带说明，有快照 = 分数即存活率', () => {
    expect(computeDimensions(active, [], {}).incremental).toEqual({
      score: 100,
      issues: 0,
      details: { note: 'no 30d snapshot available' },
    });
    expect(computeDimensions(active, [], {
      survival: { rate: 60, survived: 6, total: 10, snapshotDate: '2026-08-10' },
    }).incremental).toEqual({
      score: 60,
      issues: 4,
      details: { survivalRate: 60, survived: 6, total: 10, snapshotDate: '2026-08-10' },
    });
  });

  it('空人口：结构与成熟度满分、飞轮零分（无活动可测）', () => {
    const dims = computeDimensions([], [], {});
    expect(dims.structure.score).toBe(100);
    expect(dims.maturity.score).toBe(100);
    expect(dims.flywheel.score).toBe(0);
  });
});

describe('calculateHealthScore', () => {
  const base = [makeEntry({ id: 'H-1', maturity: 'verified' }), makeEntry({ id: 'H-2', maturity: 'verified' })];
  const issue = (severity: AuditIssue['severity']): AuditIssue => ({
    rule: 'short-content', entryId: 'H-1', title: 'H', severity, action: 'flag', detail: '',
  });

  it('无问题 = 100', () => {
    expect(calculateHealthScore(base, [])).toBe(100);
  });

  it('惩罚按严重度分级：critical > high > medium > low', () => {
    const critical = calculateHealthScore(base, [issue('critical')]);
    const low = calculateHealthScore(base, [issue('low')]);
    expect(critical).toBeLessThan(low);
    expect(low).toBeLessThan(100);
  });

  it('四档严重度各自的罚分权重（满分 100，人口 2 → 每条满罚 10 分权重）', () => {
    // penalty / (entries × 10) → critical 10、high 5、medium 2、low 1
    expect(calculateHealthScore(base, [issue('critical')])).toBe(50);
    expect(calculateHealthScore(base, [issue('high')])).toBe(75);
    expect(calculateHealthScore(base, [issue('medium')])).toBe(90);
    expect(calculateHealthScore(base, [issue('low')])).toBe(95);
  });

  it('条目为空时恒 100（无人口不判健康度）', () => {
    expect(calculateHealthScore([], [issue('critical')])).toBe(100);
  });
});

describe('fragment-cluster（跨条目规则）', () => {
  it('同 type + 共享 ≥2 标签 + 正文均 <100 字符且 peers≥2 才成簇', () => {
    const short = (id: string, tags: string[]): KnowledgeEntry =>
      makeEntry({ id, type: 'guideline', maturity: 'verified', content: '短'.repeat(20), tags });
    const population = [short('FC-1', ['auth', 'db']), short('FC-2', ['auth', 'db']), short('FC-3', ['auth', 'db'])];
    const issues = scanEntries(population, {}, population);
    expect(issues.filter(i => i.rule === 'fragment-cluster').map(i => i.entryId).sort())
      .toEqual(['FC-1', 'FC-2', 'FC-3']);
  });

  it('peers 只有 1 个时不成簇', () => {
    const short = (id: string): KnowledgeEntry =>
      makeEntry({ id, type: 'guideline', maturity: 'verified', content: '短'.repeat(20), tags: ['auth', 'db'] });
    const population = [short('FC-1'), short('FC-2'), makeEntry({ id: 'FC-LONG', type: 'guideline', maturity: 'verified', content: '长'.repeat(120), tags: ['auth', 'db'] })];
    const issues = scanEntries(population, {}, population);
    expect(issues.filter(i => i.rule === 'fragment-cluster')).toHaveLength(0);
  });
});

describe('MAX_SOURCE_REFS', () => {
  it('正好上限不报，超一条才报', () => {
    const atLimit = makeEntry({
      id: 'R-1',
      sourceReferences: Array.from({ length: MAX_SOURCE_REFS }, (_, i) => ({ workflow: `w${i}`, timestamp: '' })),
    });
    const overLimit = makeEntry({
      id: 'R-2',
      sourceReferences: Array.from({ length: MAX_SOURCE_REFS + 1 }, (_, i) => ({ workflow: `w${i}`, timestamp: '' })),
    });
    expect(scanEntries([atLimit], {}).some(i => i.rule === 'source-refs-bloat')).toBe(false);
    expect(scanEntries([overLimit], {}).some(i => i.rule === 'source-refs-bloat')).toBe(true);
  });
});
