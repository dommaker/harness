/**
 * 知识成熟度进化器
 *
 * 从 ConstraintEvolver 转型，聚焦知识成熟度进化：
 * - 基于引用数据提议成熟度变更
 * - 自动审核（安全规则）
 * - 执行变更
 */

import type { KnowledgeEntry, MaturityLevel } from '../knowledge/types';
import type { KnowledgeDiagnosis } from './knowledge-doctor';
import { KnowledgeStore } from '../knowledge/store';

// ── 进化提案 ─────────────────────────────────────────────

export type ProposalAction = 'promote' | 'demote' | 'archive' | 'merge' | 'freeze';

export interface EvolutionProposal {
  id: string;
  entryId: string;
  action: ProposalAction;
  currentMaturity: MaturityLevel;
  targetMaturity: MaturityLevel;
  reason: string;
  evidence: string[];
  risk: 'low' | 'medium' | 'high';
  autoApprovable: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'implemented';
  createdAt: string;
}

export interface EvolutionReport {
  timestamp: string;
  proposals: EvolutionProposal[];
  summary: Record<ProposalAction, number>;
}

// ── 配置 ─────────────────────────────────────────────────

export interface KnowledgeEvolverConfig {
  /** 升级所需最小引用次数 */
  promoteThreshold?: number;
  /** 降级触发天数（未引用） */
  demoteDays?: number;
  /** 是否自动执行低风险提案 */
  autoImplement?: boolean;
}

const DEFAULT_CONFIG: Required<KnowledgeEvolverConfig> = {
  promoteThreshold: 2,
  demoteDays: 180,
  autoImplement: false,
};

// ── 成熟度进化规则 ───────────────────────────────────────

const MATURITY_ORDER: MaturityLevel[] = ['draft', 'verified', 'proven'];

function nextMaturity(current: MaturityLevel): MaturityLevel | undefined {
  const idx = MATURITY_ORDER.indexOf(current);
  return idx < MATURITY_ORDER.length - 1 ? MATURITY_ORDER[idx + 1] : undefined;
}

function prevMaturity(current: MaturityLevel): MaturityLevel | undefined {
  const idx = MATURITY_ORDER.indexOf(current);
  return idx > 0 ? MATURITY_ORDER[idx - 1] : undefined;
}

// ── 知识进化器 ───────────────────────────────────────────

export class KnowledgeEvolver {
  private config: Required<KnowledgeEvolverConfig>;
  private store?: KnowledgeStore;

  constructor(config?: KnowledgeEvolverConfig, store?: KnowledgeStore) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = store;
  }

  /**
   * 从知识条目和诊断生成进化提案
   */
  generateProposals(
    entries: KnowledgeEntry[],
    diagnoses: KnowledgeDiagnosis[] = [],
  ): EvolutionProposal[] {
    const proposals: EvolutionProposal[] = [];

    for (const entry of entries) {
      if (entry.maturity === 'archived') continue;

      // 升级检查
      const promoteProposal = this.checkPromote(entry);
      if (promoteProposal) proposals.push(promoteProposal);

      // 降级检查
      const demoteProposal = this.checkDemote(entry);
      if (demoteProposal) proposals.push(demoteProposal);
    }

    // 从诊断生成提案
    for (const diagnosis of diagnoses) {
      if (diagnosis.type === 'contradiction' && diagnosis.entryId) {
        const entry = entries.find(e => e.id === diagnosis.entryId);
        if (entry) {
          proposals.push({
            id: `freeze-${entry.id}-${Date.now()}`,
            entryId: entry.id,
            action: 'freeze',
            currentMaturity: entry.maturity,
            targetMaturity: entry.maturity,
            reason: diagnosis.description,
            evidence: [diagnosis.rootCause],
            risk: 'medium',
            autoApprovable: false,
            status: 'pending',
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    return proposals;
  }

  /**
   * 检查是否可以升级
   */
  private checkPromote(entry: KnowledgeEntry): EvolutionProposal | undefined {
    const target = nextMaturity(entry.maturity);
    if (!target) return undefined;

    const refCount = entry.referencedBy.length;
    const projectCount = entry.projects.length;

    // draft → verified: 需要至少 1 次引用
    if (entry.maturity === 'draft' && refCount >= 1) {
      return this.createProposal(entry, 'promote', target,
        `被引用 ${refCount} 次，可以升级为 verified`,
        [`引用次数: ${refCount}`],
        'low',
      );
    }

    // verified → proven: 需要 ≥2 个项目验证
    if (entry.maturity === 'verified' && projectCount >= this.config.promoteThreshold) {
      return this.createProposal(entry, 'promote', target,
        `被 ${projectCount} 个项目验证，可以升级为 proven`,
        [`项目数: ${projectCount}`],
        'low',
      );
    }

    return undefined;
  }

  /**
   * 检查是否应该降级
   */
  private checkDemote(entry: KnowledgeEntry): EvolutionProposal | undefined {
    const target = prevMaturity(entry.maturity);
    if (!target) return undefined;

    const lastRef = entry.lastReferenced
      ? new Date(entry.lastReferenced)
      : new Date(entry.created);
    const daysSinceRef = Math.floor(
      (Date.now() - lastRef.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSinceRef >= this.config.demoteDays) {
      return this.createProposal(entry, 'demote', target,
        `超过 ${this.config.demoteDays} 天未引用，建议降级`,
        [`最后引用: ${daysSinceRef} 天前`],
        'low',
      );
    }

    return undefined;
  }

  private createProposal(
    entry: KnowledgeEntry,
    action: ProposalAction,
    targetMaturity: MaturityLevel,
    reason: string,
    evidence: string[],
    risk: 'low' | 'medium' | 'high',
  ): EvolutionProposal {
    return {
      id: `${action}-${entry.id}-${Date.now()}`,
      entryId: entry.id,
      action,
      currentMaturity: entry.maturity,
      targetMaturity,
      reason,
      evidence,
      risk,
      autoApprovable: risk === 'low',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 审核提案（规则自动审核）
   */
  review(proposal: EvolutionProposal): { approved: boolean; reason: string } {
    // 安全规则：proven 不允许直接归档
    if (proposal.currentMaturity === 'proven' && proposal.action === 'archive') {
      return { approved: false, reason: 'proven 条目不允许直接归档，需先降级' };
    }

    // 安全规则：矛盾条目不允许升级
    if (proposal.action === 'promote' && proposal.risk === 'high') {
      return { approved: false, reason: '高风险提案需要人工审核' };
    }

    // 低风险自动通过
    if (proposal.risk === 'low' && proposal.autoApprovable) {
      return { approved: true, reason: '低风险提案自动通过' };
    }

    return { approved: true, reason: '提案通过审核' };
  }

  /**
   * 执行提案
   */
  implement(proposal: EvolutionProposal): boolean {
    if (!this.store) return false;
    if (proposal.status !== 'approved') return false;

    const entry = this.store.get(proposal.entryId);
    if (!entry) return false;

    switch (proposal.action) {
      case 'promote':
      case 'demote':
        this.store.update(proposal.entryId, { maturity: proposal.targetMaturity });
        break;
      case 'archive':
        this.store.update(proposal.entryId, { maturity: 'archived' as MaturityLevel });
        break;
      case 'freeze':
        // 冻结：不修改成熟度，只标记
        break;
      default:
        return false;
    }

    proposal.status = 'implemented';
    return true;
  }

  /**
   * 批量审核 + 执行
   */
  processProposals(proposals: EvolutionProposal[]): EvolutionReport {
    for (const proposal of proposals) {
      const review = this.review(proposal);
      if (review.approved) {
        proposal.status = 'approved';
        if (this.config.autoImplement && proposal.autoApprovable) {
          this.implement(proposal);
        }
      } else {
        proposal.status = 'rejected';
      }
    }

    const summary: Record<ProposalAction, number> = {
      promote: 0,
      demote: 0,
      archive: 0,
      merge: 0,
      freeze: 0,
    };
    for (const p of proposals) {
      summary[p.action]++;
    }

    return {
      timestamp: new Date().toISOString(),
      proposals,
      summary,
    };
  }
}
