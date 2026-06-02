/**
 * 知识库质量审计引擎
 *
 * 纯代码检测，零 token 成本。
 * 6 维度覆盖：结构完整性 / 内容质量 / 去重有效性 / 成熟度健康 / 新鲜度 / 飞轮验证
 *
 * 两种模式：
 * - validate(entry): 单条入库检查（ingest gate）
 * - run(autoFix): 全量扫描（日兜底 / 手动）
 */

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeStore } from './store';
import type { KnowledgeEntry, MaturityLevel } from './types';

// ── Types ─────────────────────────────────────────────────

export type AuditRuleName =
  // D1: 结构完整性
  | 'frontmatter-missing'
  // D2: 内容质量
  | 'test-data-pollution'
  | 'daily-audit-noise'
  | 'zero-content-proven'
  | 'short-content'
  | 'maturity-inflation'
  // D3: 去重有效性
  | 'title-duplicate'
  | 'source-refs-bloat'
  // D4: 成熟度健康
  | 'promotion-blocked'
  | 'orphan-draft'
  // D5: 新鲜度
  | 'stale-entry';

export type AuditAction = 'archive' | 'demote' | 'flag' | 'reject' | 'trim';

export interface AuditIssue {
  rule: AuditRuleName;
  entryId: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: AuditAction;
  detail: string;
}

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
  };
  autoFixed: number;
  healthScore: { before: number; after: number };
}

export interface AuditOptions {
  baseDir?: string;
  autoFix?: boolean;
  shortContentThreshold?: number;
  staleDays?: number;
  promotionBlockDays?: number;
}

// ── Constants ─────────────────────────────────────────────

const DEFAULT_SHORT_CONTENT_THRESHOLD = 50;
const ZERO_CONTENT_THRESHOLD = 20;
const DEFAULT_STALE_DAYS = 90;
const DEFAULT_PROMOTION_BLOCK_DAYS = 30;
const MAX_SOURCE_REFS = 20;

const TEST_TAG_PATTERNS = [/^test-scope-/, /^test-empty-/, /^test-\d/];
const DAILY_AUDIT_PATTERN = /^\[Auditor\] Daily audit/;
const REQUIRED_FRONTMATTER = ['id', 'type', 'title', 'maturity'];

// ── Per-Entry Rules ───────────────────────────────────────

interface AuditRule {
  name: AuditRuleName;
  severity: AuditIssue['severity'];
  action: AuditAction;
  detect: (entry: KnowledgeEntry, ctx: AuditContext) => string | null;
}

interface AuditContext {
  shortContentThreshold: number;
  staleDays: number;
  promotionBlockDays: number;
  allEntries?: KnowledgeEntry[];
}

const perEntryRules: AuditRule[] = [
  // D1: 结构完整性
  {
    name: 'frontmatter-missing',
    severity: 'high',
    action: 'reject',
    detect: (entry) => {
      const missing = REQUIRED_FRONTMATTER.filter(f => {
        const val = (entry as any)[f];
        return val === undefined || val === null || val === '';
      });
      if (missing.length > 0) {
        return `缺少必填字段: ${missing.join(', ')}`;
      }
      return null;
    },
  },

  // D2: 内容质量
  {
    name: 'test-data-pollution',
    severity: 'critical',
    action: 'archive',
    detect: (entry) => {
      if (entry.maturity === 'archived') return null;
      const hasTestTag = entry.tags.some(t => TEST_TAG_PATTERNS.some(p => p.test(t)));
      if (hasTestTag) {
        return `测试标签: ${entry.tags.filter(t => TEST_TAG_PATTERNS.some(p => p.test(t))).join(', ')}`;
      }
      if (/^(Test Entry|Test pattern|Test incident|Empty Test)$/i.test(entry.title.trim())) {
        return `测试标题: "${entry.title}"`;
      }
      return null;
    },
  },
  {
    name: 'daily-audit-noise',
    severity: 'high',
    action: 'archive',
    detect: (entry) => {
      if (entry.maturity === 'archived') return null;
      if (DAILY_AUDIT_PATTERN.test(entry.title)) {
        return `每日审计摘要: "${entry.title}"`;
      }
      return null;
    },
  },
  {
    name: 'zero-content-proven',
    severity: 'critical',
    action: 'demote',
    detect: (entry) => {
      if (entry.maturity === 'proven' && entry.content.trim().length < ZERO_CONTENT_THRESHOLD) {
        return `proven 条目内容仅 ${entry.content.trim().length} 字符`;
      }
      return null;
    },
  },
  {
    name: 'maturity-inflation',
    severity: 'high',
    action: 'demote',
    detect: (entry) => {
      if (entry.maturity === 'verified' && entry.content.trim().length < ZERO_CONTENT_THRESHOLD) {
        return `verified 条目内容仅 ${entry.content.trim().length} 字符`;
      }
      return null;
    },
  },
  {
    name: 'short-content',
    severity: 'medium',
    action: 'flag',
    detect: (entry, ctx) => {
      if (entry.maturity === 'archived') return null;
      const len = entry.content.trim().length;
      if (len < ctx.shortContentThreshold && len >= ZERO_CONTENT_THRESHOLD) {
        return `内容 ${len} 字符 (阈值 ${ctx.shortContentThreshold})`;
      }
      return null;
    },
  },

  // D3: 去重有效性
  {
    name: 'title-duplicate',
    severity: 'medium',
    action: 'flag',
    detect: (entry, ctx) => {
      if (entry.maturity === 'archived') return null;
      if (!ctx.allEntries) return null;
      const dupes = ctx.allEntries.filter(e =>
        e.id !== entry.id &&
        e.maturity !== 'archived' &&
        e.type === entry.type &&
        e.title.toLowerCase().trim() === entry.title.toLowerCase().trim()
      );
      if (dupes.length > 0) {
        return `与 ${dupes.map(e => e.id).join(', ')} 标题重复`;
      }
      return null;
    },
  },
  {
    name: 'source-refs-bloat',
    severity: 'low',
    action: 'trim',
    detect: (entry) => {
      if ((entry.sourceReferences?.length || 0) > MAX_SOURCE_REFS) {
        return `sourceReferences ${entry.sourceReferences!.length} 条 (上限 ${MAX_SOURCE_REFS})`;
      }
      return null;
    },
  },

  // D4: 成熟度健康
  {
    name: 'promotion-blocked',
    severity: 'medium',
    action: 'flag',
    detect: (entry, ctx) => {
      if (entry.maturity !== 'draft') return null;
      const created = new Date(entry.created);
      const daysSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreated > ctx.promotionBlockDays && !entry.lastReferenced) {
        return `draft 已 ${Math.floor(daysSinceCreated)} 天未被引用`;
      }
      return null;
    },
  },
  {
    name: 'orphan-draft',
    severity: 'low',
    action: 'flag',
    detect: (entry) => {
      if (entry.maturity !== 'draft') return null;
      if (entry.contributors.length === 0 && entry.projects.length === 0 && entry.referencedBy.length === 0) {
        return `draft 无贡献者/项目/引用`;
      }
      return null;
    },
  },

  // D5: 新鲜度
  {
    name: 'stale-entry',
    severity: 'medium',
    action: 'flag',
    detect: (entry, ctx) => {
      if (entry.maturity === 'archived') return null;
      const lastRef = entry.lastReferenced || entry.created;
      if (!lastRef) return null;
      const daysSinceRef = (Date.now() - new Date(lastRef).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceRef > ctx.staleDays) {
        return `超过 ${Math.floor(daysSinceRef)} 天未引用 (阈值 ${ctx.staleDays})`;
      }
      return null;
    },
  },
];

// ── Audit Engine ──────────────────────────────────────────

export class KnowledgeAudit {
  private store: KnowledgeStore;
  private shortContentThreshold: number;
  private staleDays: number;
  private promotionBlockDays: number;

  constructor(options?: AuditOptions) {
    this.store = new KnowledgeStore({ baseDir: options?.baseDir });
    this.shortContentThreshold = options?.shortContentThreshold ?? DEFAULT_SHORT_CONTENT_THRESHOLD;
    this.staleDays = options?.staleDays ?? DEFAULT_STALE_DAYS;
    this.promotionBlockDays = options?.promotionBlockDays ?? DEFAULT_PROMOTION_BLOCK_DAYS;
  }

  /**
   * 单条入库检查（ingest gate 模式）
   */
  validate(entry: KnowledgeEntry): AuditIssue[] {
    const ctx: AuditContext = {
      shortContentThreshold: this.shortContentThreshold,
      staleDays: this.staleDays,
      promotionBlockDays: this.promotionBlockDays,
    };
    const issues: AuditIssue[] = [];
    for (const rule of perEntryRules) {
      const detail = rule.detect(entry, ctx);
      if (detail) {
        issues.push({
          rule: rule.name,
          entryId: entry.id,
          title: entry.title,
          severity: rule.severity,
          action: rule.action,
          detail,
        });
      }
    }
    return issues;
  }

  /**
   * 全量扫描（日兜底 / 手动模式）
   */
  run(options?: { autoFix?: boolean }): AuditReport {
    const entries = this.store.list({ excludeArchived: false });
    const ctx: AuditContext = {
      shortContentThreshold: this.shortContentThreshold,
      staleDays: this.staleDays,
      promotionBlockDays: this.promotionBlockDays,
      allEntries: entries,
    };

    // Per-entry issues
    const allIssues: AuditIssue[] = [];
    for (const entry of entries) {
      for (const rule of perEntryRules) {
        const detail = rule.detect(entry, ctx);
        if (detail) {
          allIssues.push({
            rule: rule.name,
            entryId: entry.id,
            title: entry.title,
            severity: rule.severity,
            action: rule.action,
            detail,
          });
        }
      }
    }

    // Summary
    const summary = {} as Record<AuditRuleName, number>;
    for (const rule of perEntryRules) summary[rule.name] = 0;
    for (const issue of allIssues) summary[issue.rule]++;

    // Dimension metrics
    const dimensions = this.computeDimensions(entries, allIssues);

    // Health score (before)
    const healthBefore = this.calculateHealthScore(entries, allIssues);

    // Auto-fix
    let autoFixed = 0;
    if (options?.autoFix) {
      autoFixed = this.applyFixes(allIssues);
    }

    // Health score (after)
    const entriesAfter = options?.autoFix ? this.store.list({ excludeArchived: false }) : entries;
    const issuesAfter = options?.autoFix ? this.runScan(entriesAfter, ctx) : allIssues;
    const healthAfter = this.calculateHealthScore(entriesAfter, issuesAfter);

    return {
      timestamp: new Date().toISOString(),
      totalEntries: entries.length,
      issues: allIssues,
      summary,
      dimensions,
      autoFixed,
      healthScore: { before: healthBefore, after: healthAfter },
    };
  }

  // ── Dimensions ────────────────────────────────────────────

  private computeDimensions(entries: KnowledgeEntry[], issues: AuditIssue[]): AuditReport['dimensions'] {
    const active = entries.filter(e => e.maturity !== 'archived');
    const now = Date.now();

    // D1: 结构完整性
    const d1Issues = issues.filter(i => i.rule === 'frontmatter-missing');
    const d1Score = entries.length === 0 ? 100 : Math.max(0, 100 - (d1Issues.length / entries.length) * 100);

    // D2: 内容质量
    const d2Rules: AuditRuleName[] = ['test-data-pollution', 'daily-audit-noise', 'zero-content-proven', 'short-content', 'maturity-inflation'];
    const d2Issues = issues.filter(i => d2Rules.includes(i.rule));
    const d2Score = active.length === 0 ? 100 : Math.max(0, 100 - (d2Issues.length / active.length) * 100);

    // D3: 去重有效性
    const d3Rules: AuditRuleName[] = ['title-duplicate', 'source-refs-bloat'];
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

    // D6: 飞轮验证
    const withRefs = active.filter(e => e.referencedBy.length > 0).length;
    const refCoverage = active.length > 0 ? withRefs / active.length : 0;
    const avgRefs = active.length > 0
      ? active.reduce((sum, e) => sum + e.referencedBy.length, 0) / active.length
      : 0;

    // Consumption hit rate from aggregated stats file (written by MonitorAgent)
    let consumptionHitRate = 0;
    let dailyConsumptionEvents = 0;
    try {
      const statsPath = path.join(this.store.getBaseDir(), '.consumption-stats.json');
      if (fs.existsSync(statsPath)) {
        const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
        dailyConsumptionEvents = stats.dailyEvents || 0;
        // hitRate: daily events / active entries, capped at 1
        consumptionHitRate = active.length > 0
          ? Math.min(dailyConsumptionEvents / active.length, 1)
          : 0;
      }
    } catch { /* best-effort */ }

    // Score: refCoverage * 50 + avgRefs * 20 + consumptionHitRate * 30
    const d6Score = Math.min(100, Math.round(
      refCoverage * 50 +
      Math.min(avgRefs / 5, 1) * 20 +
      consumptionHitRate * 30
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
          activeEntries: active.length,
          entriesWithRefs: withRefs,
          refCoverage: Math.round(refCoverage * 100),
          avgRefCount: Math.round(avgRefs * 10) / 10,
          dailyConsumptionEvents,
          consumptionHitRate: Math.round(consumptionHitRate * 100),
        },
      },
    };
  }

  // ── Internal ────────────────────────────────────────────

  private runScan(entries: KnowledgeEntry[], ctx: AuditContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    for (const entry of entries) {
      for (const rule of perEntryRules) {
        const detail = rule.detect(entry, ctx);
        if (detail) {
          issues.push({
            rule: rule.name,
            entryId: entry.id,
            title: entry.title,
            severity: rule.severity,
            action: rule.action,
            detail,
          });
        }
      }
    }
    return issues;
  }

  private applyFixes(issues: AuditIssue[]): number {
    let fixed = 0;
    const processed = new Set<string>();

    for (const issue of issues) {
      if (processed.has(issue.entryId)) continue;

      switch (issue.action) {
        case 'archive':
          this.store.update(issue.entryId, { maturity: 'archived' });
          processed.add(issue.entryId);
          fixed++;
          break;

        case 'demote':
          this.store.update(issue.entryId, { maturity: 'draft' });
          processed.add(issue.entryId);
          fixed++;
          break;

        case 'flag': {
          const entry = this.store.get(issue.entryId);
          if (entry && !entry.tags.includes('low_quality')) {
            this.store.update(issue.entryId, { tags: [...entry.tags, 'low_quality'] });
            processed.add(issue.entryId);
            fixed++;
          }
          break;
        }

        case 'trim': {
          const entry = this.store.get(issue.entryId);
          if (entry && entry.sourceReferences && entry.sourceReferences.length > MAX_SOURCE_REFS) {
            this.store.update(issue.entryId, {
              sourceReferences: entry.sourceReferences.slice(-MAX_SOURCE_REFS),
            });
            processed.add(issue.entryId);
            fixed++;
          }
          break;
        }

        case 'reject':
          break;
      }
    }

    return fixed;
  }

  private calculateHealthScore(entries: KnowledgeEntry[], issues: AuditIssue[]): number {
    if (entries.length === 0) return 100;

    const penalty = issues.reduce((sum, issue) => {
      switch (issue.severity) {
        case 'critical': return sum + 10;
        case 'high': return sum + 5;
        case 'medium': return sum + 2;
        case 'low': return sum + 1;
        default: return sum;
      }
    }, 0);

    const maxPenalty = entries.length * 10;
    return Math.max(0, 100 - Math.round((penalty / Math.max(maxPenalty, 1)) * 100));
  }
}
