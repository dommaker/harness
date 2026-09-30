/**
 * 知识库质量审计的维度分计算（harness#134 D1–D7 纯模块的维度侧；Phase 3 自 audit-scoring.ts 拆出）
 *
 * D1–D7 七个维度的评分与报告结构：吃「条目集合 + 已跑出的 issues + 已取好的环境数据」，
 * 零 IO。逐条目规则表在 `audit-rules.ts`，规则遍历与健康分在 `audit-scoring.ts`。
 */

import { evaluateFlywheel } from './flywheel-metrics';
import type { AuditIssue, AuditRuleName } from './audit-rules';
import type { KnowledgeEntry, SnapshotSurvival } from './types';

// ── Types ─────────────────────────────────────────────────

export interface DimensionMetrics {
  score: number;  // 0-100
  issues: number;
  details: Record<string, number | string>;
}

export interface AuditReport {
  timestamp: string;
  totalEntries: number;
  issues: AuditIssue[];
  summary: Record<AuditRuleName, number>;
  dimensions: {
    structure: DimensionMetrics;
    content: DimensionMetrics;
    dedup: DimensionMetrics;
    maturity: DimensionMetrics;
    freshness: DimensionMetrics;
    flywheel: DimensionMetrics;
    incremental: DimensionMetrics;
  };
  autoFixed: number;
  healthScore: { before: number; after: number };
}

/** 打分要吃的已取好环境数据——由调用方从存储层取，本模块不碰 fs */
export interface AuditEnv {
  /** `.consumption-stats.json` 的 dailyEvents（D6 飞轮）；未提供视为 0 */
  dailyConsumptionEvents?: number;
  /** N 天前快照的存活率（D7 增量存活）；未提供 = 无可用快照 */
  survival?: SnapshotSurvival;
}

// ── Constants ─────────────────────────────────────────────

/** D7 增量存活取的快照龄期（天） */
export const SURVIVAL_SNAPSHOT_DAYS = 30;

// ── Dimensions ────────────────────────────────────────────

export function computeDimensions(
  entries: KnowledgeEntry[],
  issues: AuditIssue[],
  env: AuditEnv = {},
): AuditReport['dimensions'] {
  const active = entries.filter(e => e.maturity !== 'archived');
  const now = Date.now();

  // D1: 结构完整性
  const d1Issues = issues.filter(i => i.rule === 'frontmatter-missing');
  const d1Score = entries.length === 0 ? 100 : Math.max(0, 100 - (d1Issues.length / entries.length) * 100);

  // D2: 内容质量
  const d2Rules: AuditRuleName[] = ['test-data-pollution', 'daily-audit-noise', 'event-noise', 'zero-content-proven', 'short-content', 'maturity-inflation', 'deprecated-domain'];
  const d2Issues = issues.filter(i => d2Rules.includes(i.rule));
  const d2Score = active.length === 0 ? 100 : Math.max(0, 100 - (d2Issues.length / active.length) * 100);

  // D3: 去重有效性
  const d3Rules: AuditRuleName[] = ['title-duplicate', 'source-refs-bloat', 'fragment-cluster'];
  const d3Issues = issues.filter(i => d3Rules.includes(i.rule));
  const d3Score = active.length === 0 ? 100 : Math.max(0, 100 - (d3Issues.length / active.length) * 100);

  // D4: 成熟度健康
  const d4Rules: AuditRuleName[] = ['promotion-blocked', 'orphan-draft'];
  const d4Issues = issues.filter(i => d4Rules.includes(i.rule));
  const byMaturity: Record<string, number> = {};
  for (const e of entries) byMaturity[e.maturity] = (byMaturity[e.maturity] || 0) + 1;
  const draftRatio = entries.length > 0 ? (byMaturity['draft'] || 0) / entries.length : 0;
  const provenRatio = entries.length > 0 ? (byMaturity['proven'] || 0) / entries.length : 0;
  // Penalize: draft >50% or proven <2% or proven >20% (test inflation)
  let d4Penalty = d4Issues.length * 2;
  if (draftRatio > 0.5) d4Penalty += 10;
  if (provenRatio < 0.02 && entries.length > 20) d4Penalty += 5;
  if (provenRatio > 0.2) d4Penalty += 5; // likely test inflation
  const d4Score = entries.length === 0 ? 100 : Math.max(0, 100 - (d4Penalty / entries.length) * 100);

  // D5: 新鲜度
  const d5Issues = issues.filter(i => i.rule === 'stale-entry');
  const ages = active.map(e => {
    const lastRef = e.lastReferenced || e.created;
    return lastRef ? (now - new Date(lastRef).getTime()) / (1000 * 60 * 60 * 24) : 999;
  });
  const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
  const staleRatio = active.length > 0 ? d5Issues.length / active.length : 0;
  const d5Score = active.length === 0 ? 100 : Math.max(0, 100 - (staleRatio * 100));

  // D6: 飞轮验证 —— 指标计算唯一实现在 flywheel-metrics，本模块只做报告层映射
  const metrics = evaluateFlywheel({
    entries: active,
    dailyConsumptionEvents: env.dailyConsumptionEvents ?? 0,
  });

  // Score: refCoverage * 50 + avgRefs * 20 + consumptionHitRate * 30
  const d6Score = Math.min(100, Math.round(
    metrics.refCoverage * 50 +
    Math.min(metrics.avgRefs / 5, 1) * 20 +
    metrics.consumptionHitRate * 30
  ));

  return {
    structure: {
      score: Math.round(d1Score),
      issues: d1Issues.length,
      details: { invalidEntries: d1Issues.length },
    },
    content: {
      score: Math.round(d2Score),
      issues: d2Issues.length,
      details: {
        testData: issues.filter(i => i.rule === 'test-data-pollution').length,
        dailyAudit: issues.filter(i => i.rule === 'daily-audit-noise').length,
        zeroContent: issues.filter(i => i.rule === 'zero-content-proven').length,
        shortContent: issues.filter(i => i.rule === 'short-content').length,
        maturityInflation: issues.filter(i => i.rule === 'maturity-inflation').length,
      },
    },
    dedup: {
      score: Math.round(d3Score),
      issues: d3Issues.length,
      details: {
        titleDuplicates: issues.filter(i => i.rule === 'title-duplicate').length,
        sourceRefsBloat: issues.filter(i => i.rule === 'source-refs-bloat').length,
      },
    },
    maturity: {
      score: Math.round(d4Score),
      issues: d4Issues.length,
      details: {
        draft: byMaturity['draft'] || 0,
        verified: byMaturity['verified'] || 0,
        proven: byMaturity['proven'] || 0,
        archived: byMaturity['archived'] || 0,
        draftRatio: Math.round(draftRatio * 100),
        provenRatio: Math.round(provenRatio * 100),
        promotionBlocked: issues.filter(i => i.rule === 'promotion-blocked').length,
      },
    },
    freshness: {
      score: Math.round(d5Score),
      issues: d5Issues.length,
      details: {
        avgAgeDays: Math.round(avgAge),
        staleEntries: d5Issues.length,
        staleRatio: Math.round(staleRatio * 100),
      },
    },
    flywheel: {
      score: d6Score,
      issues: 0,
      details: {
        activeEntries: metrics.activeEntries,
        entriesWithRefs: metrics.entriesWithRefs,
        refCoverage: Math.round(metrics.refCoverage * 100),
        avgRefCount: Math.round(metrics.avgRefs * 10) / 10,
        dailyConsumptionEvents: metrics.dailyConsumptionEvents,
        consumptionHitRate: Math.round(metrics.consumptionHitRate * 100),
      },
    },
    incremental: computeIncremental(env.survival),
  };
}

export function computeIncremental(survival?: SnapshotSurvival): DimensionMetrics {
  if (!survival) {
    return { score: 100, issues: 0, details: { note: 'no 30d snapshot available' } };
  }
  // Score = survival rate directly (80% target → 80/100)
  return {
    score: survival.rate,
    issues: survival.total - survival.survived,
    details: {
      survivalRate: survival.rate,
      survived: survival.survived,
      total: survival.total,
      snapshotDate: survival.snapshotDate,
    },
  };
}
