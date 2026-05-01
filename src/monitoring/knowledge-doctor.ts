/**
 * 知识库健康诊断
 *
 * 从 ConstraintDoctor 转型，聚焦知识库健康：
 * - 孤儿条目检测
 * - 矛盾检测
 * - 过时检测
 * - 成熟度异常
 * - 引用健康度
 */

import type { KnowledgeEntry, LintIssue } from '../knowledge/types';
import type { ConstraintStats } from '../constraints/types';

// ── 诊断类型 ─────────────────────────────────────────────

export type DiagnosisSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface KnowledgeDiagnosis {
  id: string;
  type: 'orphan' | 'contradiction' | 'outdated' | 'decay' | 'low_reference' | 'stale_index';
  severity: DiagnosisSeverity;
  entryId?: string;
  title: string;
  description: string;
  rootCause: string;
  impact: string;
  recommendations: string[];
  timestamp: string;
}

export interface DiagnosisReport {
  timestamp: string;
  totalEntries: number;
  healthScore: number; // 0-100
  diagnoses: KnowledgeDiagnosis[];
  summary: Record<DiagnosisSeverity, number>;
}

// ── 配置 ─────────────────────────────────────────────────

export interface KnowledgeDoctorConfig {
  /** 低引用阈值（低于此值标记为 low_reference） */
  lowReferenceThreshold?: number;
  /** 过时天数（超过此天数未引用标记为 outdated） */
  outdatedDays?: number;
  /** 衰减预警天数 */
  decayWarningDays?: number;
}

const DEFAULT_CONFIG: Required<KnowledgeDoctorConfig> = {
  lowReferenceThreshold: 2,
  outdatedDays: 180,
  decayWarningDays: 90,
};

// ── 知识库诊断器 ─────────────────────────────────────────

export class KnowledgeDoctor {
  private config: Required<KnowledgeDoctorConfig>;

  constructor(config?: KnowledgeDoctorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 诊断知识库健康
   */
  diagnose(entries: KnowledgeEntry[], lintIssues: LintIssue[] = []): DiagnosisReport {
    const diagnoses: KnowledgeDiagnosis[] = [];

    // 从 lint issues 转换
    diagnoses.push(...this.fromLintIssues(lintIssues));

    // 知识库特有诊断
    diagnoses.push(...this.checkOrphans(entries));
    diagnoses.push(...this.checkOutdated(entries));
    diagnoses.push(...this.checkDecay(entries));
    diagnoses.push(...this.checkLowReference(entries));

    // 计算健康分数
    const healthScore = this.calculateHealthScore(entries, diagnoses);

    // 统计
    const summary: Record<DiagnosisSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    for (const d of diagnoses) {
      summary[d.severity]++;
    }

    return {
      timestamp: new Date().toISOString(),
      totalEntries: entries.length,
      healthScore,
      diagnoses,
      summary,
    };
  }

  /**
   * 从 Lint issues 生成诊断
   */
  private fromLintIssues(issues: LintIssue[]): KnowledgeDiagnosis[] {
    return issues.map(issue => ({
      id: `lint-${issue.type}-${issue.entryId ?? 'unknown'}`,
      type: issue.type as KnowledgeDiagnosis['type'],
      severity: issue.severity,
      entryId: issue.entryId,
      title: issue.description,
      description: issue.description,
      rootCause: this.inferRootCause(issue),
      impact: this.inferImpact(issue),
      recommendations: [issue.suggestion],
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * 检查孤儿条目
   */
  private checkOrphans(entries: KnowledgeEntry[]): KnowledgeDiagnosis[] {
    const diagnoses: KnowledgeDiagnosis[] = [];

    for (const entry of entries) {
      if (entry.maturity === 'archived') continue;

      const hasRefs = entry.referencedBy.length > 0;
      const hasContributors = entry.contributors.length > 0;
      const hasProjects = entry.projects.length > 0;

      if (!hasRefs && !hasContributors && !hasProjects && entry.maturity === 'draft') {
        diagnoses.push({
          id: `orphan-${entry.id}`,
          type: 'orphan',
          severity: 'low',
          entryId: entry.id,
          title: `孤儿条目: ${entry.title}`,
          description: `条目 ${entry.id} 无引用、无贡献者、无项目验证`,
          rootCause: '条目可能是自动生成但未被任何工作流引用',
          impact: '占用知识库空间但不产生价值',
          recommendations: ['归档该条目', '或标记为需要验证后等待引用'],
          timestamp: new Date().toISOString(),
        });
      }
    }

    return diagnoses;
  }

  /**
   * 检查过时条目
   */
  private checkOutdated(entries: KnowledgeEntry[]): KnowledgeDiagnosis[] {
    const diagnoses: KnowledgeDiagnosis[] = [];
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - this.config.outdatedDays);

    for (const entry of entries) {
      if (entry.maturity === 'archived') continue;
      if (entry.maturity !== 'draft') continue;

      const lastRef = entry.lastReferenced ? new Date(entry.lastReferenced) : new Date(entry.created);
      if (lastRef < threshold) {
        diagnoses.push({
          id: `outdated-${entry.id}`,
          type: 'outdated',
          severity: 'medium',
          entryId: entry.id,
          title: `过时条目: ${entry.title}`,
          description: `条目 ${entry.id} 超过 ${this.config.outdatedDays} 天未引用且为 draft`,
          rootCause: '长期未被引用，可能已失去相关性',
          impact: '降低知识库整体质量',
          recommendations: ['归档该条目', '或验证后提升成熟度'],
          timestamp: new Date().toISOString(),
        });
      }
    }

    return diagnoses;
  }

  /**
   * 检查衰减预警
   */
  private checkDecay(entries: KnowledgeEntry[]): KnowledgeDiagnosis[] {
    const diagnoses: KnowledgeDiagnosis[] = [];
    const warningThreshold = new Date();
    warningThreshold.setDate(warningThreshold.getDate() - this.config.decayWarningDays);

    for (const entry of entries) {
      if (entry.maturity !== 'proven' && entry.maturity !== 'verified') continue;

      const lastRef = entry.lastReferenced ? new Date(entry.lastReferenced) : new Date(entry.created);
      if (lastRef < warningThreshold) {
        diagnoses.push({
          id: `decay-${entry.id}`,
          type: 'decay',
          severity: entry.maturity === 'proven' ? 'high' : 'medium',
          entryId: entry.id,
          title: `衰减预警: ${entry.title}`,
          description: `${entry.maturity} 条目 ${entry.id} 超过 ${this.config.decayWarningDays} 天未引用`,
          rootCause: '长期未被引用，成熟度可能需要降级',
          impact: '高成熟度条目未被引用，可能已过时',
          recommendations: ['检查条目是否仍然相关', '如已过时则降级成熟度'],
          timestamp: new Date().toISOString(),
        });
      }
    }

    return diagnoses;
  }

  /**
   * 检查低引用条目
   */
  private checkLowReference(entries: KnowledgeEntry[]): KnowledgeDiagnosis[] {
    const diagnoses: KnowledgeDiagnosis[] = [];

    for (const entry of entries) {
      if (entry.maturity === 'archived') continue;
      if (entry.maturity === 'draft') continue;

      if (entry.referencedBy.length < this.config.lowReferenceThreshold) {
        diagnoses.push({
          id: `low-ref-${entry.id}`,
          type: 'low_reference',
          severity: 'low',
          entryId: entry.id,
          title: `低引用: ${entry.title}`,
          description: `${entry.maturity} 条目 ${entry.id} 仅被引用 ${entry.referencedBy.length} 次`,
          rootCause: '条目可能不够通用或不易被发现',
          impact: '高成熟度但低引用，投入产出比低',
          recommendations: ['检查条目是否需要更新以提高相关性', '考虑在更多场景中引用'],
          timestamp: new Date().toISOString(),
        });
      }
    }

    return diagnoses;
  }

  /**
   * 计算健康分数（0-100）
   */
  private calculateHealthScore(entries: KnowledgeEntry[], diagnoses: KnowledgeDiagnosis[]): number {
    if (entries.length === 0) return 100;

    let penalty = 0;
    for (const d of diagnoses) {
      switch (d.severity) {
        case 'critical': penalty += 10; break;
        case 'high': penalty += 5; break;
        case 'medium': penalty += 2; break;
        case 'low': penalty += 1; break;
      }
    }

    // 每个条目的最大扣分
    const maxPenalty = entries.length * 10;
    const score = Math.max(0, 100 - Math.round((penalty / Math.max(maxPenalty, 1)) * 100));
    return score;
  }

  private inferRootCause(issue: LintIssue): string {
    switch (issue.type) {
      case 'orphan': return '条目未被任何工作流或项目引用';
      case 'contradiction': return '同标签下存在成熟度差异大的条目';
      case 'outdated': return '长期未引用的 draft 条目';
      case 'duplicate': return '同类型同标题的重复条目';
      case 'index_inconsistent': return '索引与磁盘文件不一致';
      default: return '未知原因';
    }
  }

  private inferImpact(issue: LintIssue): string {
    switch (issue.type) {
      case 'orphan': return '占用空间但不产生价值';
      case 'contradiction': return '可能误导 Agent 决策';
      case 'outdated': return '降低知识库整体质量';
      case 'duplicate': return '浪费查询预算';
      case 'index_inconsistent': return '可能导致查询失败';
      default: return '未知影响';
    }
  }

  /**
   * 生成诊断报告（Markdown）
   */
  generateReport(report: DiagnosisReport): string {
    const lines: string[] = [];

    lines.push(`# 知识库健康报告`);
    lines.push(`时间: ${report.timestamp}`);
    lines.push(`条目总数: ${report.totalEntries}`);
    lines.push(`健康分数: ${report.healthScore}/100`);
    lines.push('');

    lines.push(`## 问题统计`);
    lines.push(`- 严重: ${report.summary.critical}`);
    lines.push(`- 高: ${report.summary.high}`);
    lines.push(`- 中: ${report.summary.medium}`);
    lines.push(`- 低: ${report.summary.low}`);
    lines.push('');

    if (report.diagnoses.length > 0) {
      lines.push(`## 诊断详情`);
      for (const d of report.diagnoses) {
        lines.push(`### [${d.severity.toUpperCase()}] ${d.title}`);
        lines.push(d.description);
        lines.push(`**根因**: ${d.rootCause}`);
        lines.push(`**影响**: ${d.impact}`);
        lines.push(`**建议**: ${d.recommendations.join(', ')}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}
