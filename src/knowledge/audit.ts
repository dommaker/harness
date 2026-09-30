/**
 * 知识库质量审计引擎
 *
 * 纯代码检测，零 token 成本。打分判定是纯模块组 `audit-rules.ts`（规则表）+
 * `audit-scoring.ts`（评分）+ `audit-dimensions.ts`（维度分），本文件只做存储侧装配：
 * 取条目、取环境数据、落地修复动作。
 *
 * 两种模式：
 * - validate(entry): 单条入库检查（ingest gate），不读盘
 * - run(autoFix): 全量扫描（日兜底 / 手动），修复走 store.applyAll 单次索引重写
 */

import type { KnowledgeStore } from './store';
import type { KnowledgeEntry, StoreUpdate } from './types';
import { MAX_SOURCE_REFS } from './audit-rules';
import type { AuditIssue } from './audit-rules';
import { calculateHealthScore, scanEntries, summarizeIssues } from './audit-scoring';
import type { AuditOptions } from './audit-scoring';
import { SURVIVAL_SNAPSHOT_DAYS, computeDimensions } from './audit-dimensions';
import type { AuditEnv, AuditReport } from './audit-dimensions';

/** 数值槽清单（harness#163）：显式传入的脏值（NaN/±Infinity/负数）构造期抛 TypeError，不放行到打分层静默关判定 */
const NUMERIC_OPTION_SLOTS = ['shortContentThreshold', 'staleDays', 'promotionBlockDays'] as const;

/** 守卫在 `resolveThresholds` 上游（构造期）：`??` 语义不动，两处不重复兜；未传/显式 undefined 跳过，显式 0 合法 */
function assertValidThresholds(options: AuditOptions): void {
  for (const slot of NUMERIC_OPTION_SLOTS) {
    const value = options[slot];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new TypeError(`KnowledgeAudit: ${slot} 需为非负有限数，实参 ${value}`);
    }
  }
}

export class KnowledgeAudit {
  private store: KnowledgeStore;
  private options: AuditOptions;

  constructor(store: KnowledgeStore, options?: AuditOptions) {
    if (options) assertValidThresholds(options);
    this.store = store;
    this.options = options ?? {};
  }

  /**
   * 单条入库检查（ingest gate 模式）
   */
  validate(entry: KnowledgeEntry): AuditIssue[] {
    return scanEntries([entry], this.options);
  }

  /**
   * 全量扫描（日兜底 / 手动模式）
   */
  run(options?: { autoFix?: boolean }): AuditReport {
    const entries = this.store.list({ excludeArchived: false }).filter(e => e.title && e.type && e.content != null);

    // Per-entry issues
    const allIssues = scanEntries(entries, this.options, entries);

    // Dimension metrics（环境数据由 store 供给，打分本体零 IO）
    const dimensions = computeDimensions(entries, allIssues, this.readEnv());

    // Health score (before)
    const healthBefore = calculateHealthScore(entries, allIssues);

    // Auto-fix
    let autoFixed = 0;
    if (options?.autoFix) {
      autoFixed = this.applyFixes(allIssues);
    }

    // Health score (after)——重扫沿用修复前的人口作跨条目规则对照（现状口径，#134 不动判定）
    const entriesAfter = options?.autoFix ? this.store.list({ excludeArchived: false }) : entries;
    const issuesAfter = options?.autoFix ? scanEntries(entriesAfter, this.options, entries) : allIssues;
    const healthAfter = calculateHealthScore(entriesAfter, issuesAfter);

    return {
      timestamp: new Date().toISOString(),
      totalEntries: entries.length,
      issues: allIssues,
      summary: summarizeIssues(allIssues),
      dimensions,
      autoFixed,
      healthScore: { before: healthBefore, after: healthAfter },
    };
  }

  // ── Internal ────────────────────────────────────────────

  /** 打分要用的环境数据在此一次取齐（D6 消费统计、D7 快照存活） */
  private readEnv(): AuditEnv {
    return {
      dailyConsumptionEvents: this.store.getConsumptionStats()?.dailyEvents ?? 0,
      survival: this.store.getSurvivalRate(SURVIVAL_SNAPSHOT_DAYS),
    };
  }

  /** 修复动作先聚合再经 `applyAll` 落盘：一次审计只重写一次 index.json（#134） */
  private applyFixes(issues: AuditIssue[]): number {
    const updates: StoreUpdate[] = [];
    const processed = new Set<string>();

    for (const issue of issues) {
      if (processed.has(issue.entryId)) continue;

      switch (issue.action) {
        case 'archive':
          updates.push({ id: issue.entryId, partial: { maturity: 'archived' } });
          processed.add(issue.entryId);
          break;

        case 'demote':
          updates.push({ id: issue.entryId, partial: { maturity: 'draft' } });
          processed.add(issue.entryId);
          break;

        case 'flag': {
          const entry = this.store.get(issue.entryId);
          if (entry && !entry.tags.includes('low_quality')) {
            updates.push({ id: issue.entryId, partial: { tags: [...entry.tags, 'low_quality'] } });
            processed.add(issue.entryId);
          }
          break;
        }

        case 'trim': {
          const entry = this.store.get(issue.entryId);
          if (entry && entry.sourceReferences && entry.sourceReferences.length > MAX_SOURCE_REFS) {
            updates.push({
              id: issue.entryId,
              partial: { sourceReferences: entry.sourceReferences.slice(-MAX_SOURCE_REFS) },
            });
            processed.add(issue.entryId);
          }
          break;
        }

        case 'reject':
          break;
      }
    }

    this.store.applyAll(updates);
    return updates.length;
  }
}
