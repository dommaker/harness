/**
 * 知识库质量审计的评分核心（harness#134：D1–D7 纯模块的评分侧；Phase 3 拆分后只留评分）
 *
 * 纯代码检测，零 token 成本，**零 IO**：入参只有条目集合与已取好的环境数据
 * （消费统计、快照存活率由调用方经 store 取好喂进来），因此打分判定可脱离文件系统测试。
 * 落盘与修复动作在 `audit.ts` 的引擎侧。
 *
 * 拆分后的三块：规则数据表在 `audit-rules.ts`（detect 谓词 + label + 规则常量），
 * 维度分计算在 `audit-dimensions.ts`（D1–D7 报告结构），本文件是评分——阈值解析、
 * 规则遍历（scanEntries）、命中计数（summarizeIssues）、健康分（calculateHealthScore）。
 */

import { perEntryRules } from './audit-rules';
import type { AuditContext, AuditIssue, AuditRule, AuditRuleName } from './audit-rules';
import type { KnowledgeEntry } from './types';

// ── Types ─────────────────────────────────────────────────

/** 判定阈值（引擎构造入参，也是纯打分的判定口径） */
export interface AuditOptions {
  shortContentThreshold?: number;
  staleDays?: number;
  promotionBlockDays?: number;
}

// ── Constants ─────────────────────────────────────────────

export const DEFAULT_SHORT_CONTENT_THRESHOLD = 50;
export const DEFAULT_STALE_DAYS = 90;
export const DEFAULT_PROMOTION_BLOCK_DAYS = 30;

// ── Scoring ───────────────────────────────────────────────

/** 阈值缺省落点（引擎与纯打分共用同一份兜底） */
export function resolveThresholds(options: AuditOptions = {}): AuditContext {
  return {
    shortContentThreshold: options.shortContentThreshold ?? DEFAULT_SHORT_CONTENT_THRESHOLD,
    staleDays: options.staleDays ?? DEFAULT_STALE_DAYS,
    promotionBlockDays: options.promotionBlockDays ?? DEFAULT_PROMOTION_BLOCK_DAYS,
  };
}

/** 按 scope 决定是否评估：active 规则对 archived 条目不判定（人口过滤唯一落点） */
function ruleDetail(rule: AuditRule, entry: KnowledgeEntry, ctx: AuditContext): string | null {
  if (rule.scope === 'active' && entry.maturity === 'archived') return null;
  return rule.detect(entry, ctx);
}

/**
 * 逐条目跑 perEntryRules（#111 收口，#134 纯化）：validate（单条目）、run（全量）与 autoFix 重扫共用。
 * `population` = 跨条目规则（标题重复 / 碎片集群）的对照集合；不传 = 单条目入库模式，跨条目规则不判定。
 */
export function scanEntries(
  entries: KnowledgeEntry[],
  options: AuditOptions,
  population?: KnowledgeEntry[],
): AuditIssue[] {
  const ctx: AuditContext = { ...resolveThresholds(options), allEntries: population };
  const issues: AuditIssue[] = [];
  for (const entry of entries) {
    for (const rule of perEntryRules) {
      const detail = ruleDetail(rule, entry, ctx);
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

/** 规则命中计数：未命中的规则也出零值键（报告面的规则集合与规则表编译期闭环） */
export function summarizeIssues(issues: AuditIssue[]): Record<AuditRuleName, number> {
  const summary = {} as Record<AuditRuleName, number>;
  for (const rule of perEntryRules) summary[rule.name] = 0;
  for (const issue of issues) summary[issue.rule]++;
  return summary;
}

export function calculateHealthScore(entries: KnowledgeEntry[], issues: AuditIssue[]): number {
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
