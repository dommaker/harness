/**
 * Knowledge Doctor — 知识库健康评分
 *
 * 计算整体健康分数，检测需要关注的问题。
 * MonitorAgent 周期性调用，低于 60 分触发 Triage 告警。
 */

import type { KnowledgeStore } from './store';
import { KnowledgeLinter } from './lint';
import type { LintIssue } from './types';

export interface HealthDetail {
  category: string;
  score: number;
  message: string;
}

export interface HealthReport {
  score: number;
  details: HealthDetail[];
  totalEntries: number;
  timestamp: string;
}

export class KnowledgeHealthScorer {
  private store: KnowledgeStore;
  private linter: KnowledgeLinter;

  constructor(store: KnowledgeStore, linter: KnowledgeLinter) {
    this.store = store;
    this.linter = linter;
  }

  /**
   * Calculate knowledge base health score (0-100).
   *
   * Scoring:
   * - Start at 100
   * - Orphans > 10% → -20
   * - Outdated > 5% → -15
   * - Duplicates > 5% → -25 (high weight)
   * - Contradictions > 0 → -10 each
   * - Index inconsistency → -30
   */
  healthScore(): HealthReport {
    const entries = this.store.list({ excludeArchived: false });
    const totalEntries = entries.length;
    const report = this.linter.run(false); // don't autoFix, just report
    const details: HealthDetail[] = [];
    let penalty = 0;

    if (totalEntries === 0) {
      return { score: 100, details: [{ category: 'empty', score: 0, message: 'Knowledge base is empty' }], totalEntries: 0, timestamp: new Date().toISOString() };
    }

    // Orphans
    const orphanCount = report.summary.orphan;
    const orphanRate = orphanCount / totalEntries;
    if (orphanRate > 0.1) {
      penalty += 20;
      details.push({ category: 'orphans', score: -20, message: `Orphan rate ${(orphanRate * 100).toFixed(0)}% (>10%): ${orphanCount}/${totalEntries}` });
    }

    // Outdated
    const outdatedCount = report.summary.outdated;
    const outdatedRate = outdatedCount / totalEntries;
    if (outdatedRate > 0.05) {
      penalty += 15;
      details.push({ category: 'outdated', score: -15, message: `Outdated rate ${(outdatedRate * 100).toFixed(0)}% (>5%): ${outdatedCount}/${totalEntries}` });
    }

    // Duplicates (high weight)
    const dupCount = report.summary.duplicate;
    const dupRate = dupCount / totalEntries;
    if (dupRate > 0.05) {
      penalty += 25;
      details.push({ category: 'duplicates', score: -25, message: `Duplicate rate ${(dupRate * 100).toFixed(0)}% (>5%): ${dupCount}/${totalEntries}` });
    }

    // Contradictions
    const contradictionCount = report.summary.contradiction;
    if (contradictionCount > 0) {
      const contradictionPenalty = Math.min(contradictionCount * 10, 30);
      penalty += contradictionPenalty;
      details.push({ category: 'contradictions', score: -contradictionPenalty, message: `${contradictionCount} contradictions found` });
    }

    // Index inconsistency
    const indexCount = report.summary.index_inconsistent;
    if (indexCount > 0) {
      penalty += 30;
      details.push({ category: 'index', score: -30, message: `Index inconsistency: ${indexCount} issues` });
    }

    const score = Math.max(0, 100 - penalty);

    return {
      score,
      details,
      totalEntries,
      timestamp: new Date().toISOString(),
    };
  }
}
