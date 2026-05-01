/**
 * 知识库 Lint（健康检查）
 *
 * 检查项：
 * - 索引不一致（自动修复）
 * - 孤儿条目（无引用、无验证）
 * - 矛盾检测（同主题相反结论）
 * - 过时检测（6 月未引用的 draft）
 * - 重复/相似条目
 * - 成熟度衰减
 */

import { KnowledgeStore } from './store';
import { ReferenceTracker } from './reference-tracker';
import type { KnowledgeEntry, LintIssue, LintIssueType, MaturityLevel } from './types';

export interface LintReport {
  timestamp: string;
  totalEntries: number;
  issues: LintIssue[];
  fixed: number;
  summary: Record<LintIssueType, number>;
}

export class KnowledgeLinter {
  private store: KnowledgeStore;
  private tracker: ReferenceTracker;

  constructor(store: KnowledgeStore, tracker: ReferenceTracker) {
    this.store = store;
    this.tracker = tracker;
  }

  /**
   * 执行完整 Lint 检查
   */
  run(autoFix: boolean = false): LintReport {
    const entries = this.store.list({ excludeArchived: false });
    const issues: LintIssue[] = [];

    // 各项检查
    issues.push(...this.checkIndexConsistency(entries));
    issues.push(...this.checkOrphans(entries));
    issues.push(...this.checkOutdated(entries));
    issues.push(...this.checkDuplicates(entries));
    issues.push(...this.checkContradictions(entries));

    // 自动修复
    let fixed = 0;
    if (autoFix) {
      fixed = this.autoFix(issues);
    }

    // 统计
    const summary: Record<LintIssueType, number> = {
      orphan: 0,
      contradiction: 0,
      outdated: 0,
      duplicate: 0,
      index_inconsistent: 0,
    };
    for (const issue of issues) {
      summary[issue.type]++;
    }

    return {
      timestamp: new Date().toISOString(),
      totalEntries: entries.length,
      issues,
      fixed,
      summary,
    };
  }

  /**
   * 检查索引一致性
   */
  checkIndexConsistency(entries: KnowledgeEntry[]): LintIssue[] {
    const issues: LintIssue[] = [];
    const index = this.store['readIndex']();

    // 检查索引中的条目是否都有对应文件
    for (const indexEntry of index) {
      const fileEntry = this.store.get(indexEntry.id);
      if (!fileEntry) {
        issues.push({
          type: 'index_inconsistent',
          entryId: indexEntry.id,
          severity: 'medium',
          description: `索引条目 ${indexEntry.id} 无对应文件`,
          suggestion: '从索引中移除或重建索引',
        });
      }
    }

    // 检查磁盘上的文件是否都在索引中
    const indexIds = new Set(index.map(e => e.id));
    const diskEntries = this.store['readEntriesFromDisk']();
    for (const entry of diskEntries) {
      if (!indexIds.has(entry.id)) {
        issues.push({
          type: 'index_inconsistent',
          entryId: entry.id,
          severity: 'medium',
          description: `条目 ${entry.id} 不在索引中`,
          suggestion: '重建索引',
        });
      }
    }

    return issues;
  }

  /**
   * 检查孤儿条目（无引用、无验证）
   */
  checkOrphans(entries: KnowledgeEntry[]): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const entry of entries) {
      if (entry.maturity === 'archived') continue;

      const refs = this.tracker.getReferencesForEntry(entry.id);
      const hasReferences = refs.length > 0;
      const hasContributors = entry.contributors.length > 0;
      const hasProjects = entry.projects.length > 0;

      if (!hasReferences && !hasContributors && !hasProjects && entry.maturity === 'draft') {
        issues.push({
          type: 'orphan',
          entryId: entry.id,
          severity: 'low',
          description: `条目 ${entry.id} (${entry.title}) 无引用、无贡献者、无项目验证`,
          suggestion: '考虑归档或标记为需要验证',
        });
      }
    }

    return issues;
  }

  /**
   * 检查过时条目（6 月未引用的 draft）
   */
  checkOutdated(entries: KnowledgeEntry[]): LintIssue[] {
    const issues: LintIssue[] = [];
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    for (const entry of entries) {
      if (entry.maturity === 'archived') continue;

      const lastRef = entry.lastReferenced ? new Date(entry.lastReferenced) : null;
      const created = new Date(entry.created);
      const relevantDate = lastRef || created;

      if (relevantDate < sixMonthsAgo && entry.maturity === 'draft') {
        issues.push({
          type: 'outdated',
          entryId: entry.id,
          severity: 'medium',
          description: `条目 ${entry.id} (${entry.title}) 超过 6 个月未引用且为 draft`,
          suggestion: '考虑归档或提升成熟度',
        });
      }
    }

    return issues;
  }

  /**
   * 检查重复/相似条目
   */
  checkDuplicates(entries: KnowledgeEntry[]): LintIssue[] {
    const issues: LintIssue[] = [];
    const seen = new Map<string, KnowledgeEntry[]>();

    for (const entry of entries) {
      if (entry.maturity === 'archived') continue;

      // 基于 title + type 去重（大小写不敏感）
      const key = `${entry.type}:${entry.title.toLowerCase().trim()}`;
      const existing = seen.get(key) || [];
      existing.push(entry);
      seen.set(key, existing);
    }

    for (const [key, group] of seen) {
      if (group.length > 1) {
        for (const entry of group) {
          issues.push({
            type: 'duplicate',
            entryId: entry.id,
            severity: 'low',
            description: `条目 ${entry.id} (${entry.title}) 与同类型同标题的其他条目重复`,
            suggestion: `考虑合并: ${group.map(e => e.id).join(', ')}`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * 检查矛盾（同主题相反结论）
   *
   * 简单实现：同 tag 组合下成熟度冲突
   */
  checkContradictions(entries: KnowledgeEntry[]): LintIssue[] {
    const issues: LintIssue[] = [];
    const byTagGroup = new Map<string, KnowledgeEntry[]>();

    // 按 tag 组合分组
    for (const entry of entries) {
      if (entry.maturity === 'archived') continue;
      if (entry.tags.length === 0) continue;

      const tagKey = entry.tags.sort().join(',');
      const existing = byTagGroup.get(tagKey) || [];
      existing.push(entry);
      byTagGroup.set(tagKey, existing);
    }

    // 检查同 tag 组合内是否有成熟度差异大的条目
    for (const [tagKey, group] of byTagGroup) {
      if (group.length < 2) continue;

      const maturityOrder: MaturityLevel[] = ['draft', 'verified', 'proven'];
      const levels = group.map(e => maturityOrder.indexOf(e.maturity));
      const maxLevel = Math.max(...levels);
      const minLevel = Math.min(...levels);

      // 成熟度差异 >= 2 级（如 proven vs draft）
      if (maxLevel - minLevel >= 2) {
        const lowEntries = group.filter((_, i) => levels[i] === minLevel);
        for (const entry of lowEntries) {
          issues.push({
            type: 'contradiction',
            entryId: entry.id,
            severity: 'high',
            description: `条目 ${entry.id} (${entry.title}) 与同标签的高成熟度条目存在潜在矛盾`,
            suggestion: `审查标签 [${tagKey}] 下的所有条目，确认或更新`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * 自动修复可修复的问题
   */
  private autoFix(issues: LintIssue[]): number {
    let fixed = 0;

    for (const issue of issues) {
      if (issue.type === 'index_inconsistent') {
        this.store.rebuildIndex();
        fixed++;
        break; // rebuildIndex 修复所有索引问题
      }

      if (issue.type === 'outdated' && issue.entryId) {
        this.store.update(issue.entryId, { maturity: 'archived' });
        fixed++;
      }
    }

    return fixed;
  }
}
