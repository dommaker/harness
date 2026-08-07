/**
 * 约束提案流程
 *
 * 根据诊断结果提出约束修改建议
 *
 * 成本控制：
 * - 仅在诊断有结论时触发
 * - 精简 prompt
 * - ~3000 Token/次
 */

import type {
  Diagnosis,
  ConstraintProposal,
  ProposalReviewResult,
} from '../types/monitoring-types';
import type { Constraint } from '../types/constraint';

// 类型定义已归位 types 层（工单 14），此处再导出保持模块公开面不变
export type { ConstraintProposal, ProposalReviewResult };

/**
 * 约束查找函数（工单 15：约束集参数化，替代对 core/constraints/definitions 的值依赖）
 */
export type ConstraintLookup = (constraintId: string) => Constraint | null | undefined;

/**
 * Constraint Evolver - 约束进化器
 *
 * 使用方式：
 * ```typescript
 * const evolver = new ConstraintEvolver();
 * const proposal = await evolver.propose(diagnosis);
 *
 * // 审核
 * const review = evolver.review(proposal);
 *
 * // 如果接受，实施
 * if (review.accepted) {
 *   evolver.implement(proposal);
 * }
 * ```
 */
export class ConstraintEvolver {
  private proposalsDir: string;
  private constraintLookup: ConstraintLookup | undefined;

  constructor(proposalsDir?: string, constraintLookup?: ConstraintLookup) {
    this.proposalsDir = proposalsDir || '.harness/proposals';
    this.constraintLookup = constraintLookup;
  }

  /**
   * 根据诊断生成提案
 *
   * 如果诊断不需要变更，返回 null
   */
  async propose(diagnosis: Diagnosis): Promise<ConstraintProposal | null> {
    if (!diagnosis.needsChange) {
      return null;
    }

    // 找到最适合的建议
    const topRecommendation = diagnosis.recommendations[0];
    if (!topRecommendation) {
      return null;
    }

    // 生成提案
    const proposal: ConstraintProposal = {
      id: `proposal-${diagnosis.constraintId}-${Date.now()}`,
      proposedAt: Date.now(),
      diagnosisId: diagnosis.anomalyId,
      constraintId: diagnosis.constraintId,
      type: this.mapRecommendationType(topRecommendation.type),
      content: this.generateProposalContent(diagnosis, topRecommendation),
      reasoning: diagnosis.rootCause.primary,
      expectedOutcome: topRecommendation.expectedOutcome,
      risk: this.assessRisk(diagnosis, topRecommendation),
      implementation: this.estimateImplementation(diagnosis.constraintId),
      status: 'proposed',
    };

    return proposal;
  }

  /**
   * 批量生成提案
   */
  async proposeBatch(diagnoses: Diagnosis[]): Promise<ConstraintProposal[]> {
    const proposals = await Promise.all(diagnoses.map(d => this.propose(d)));
    return proposals.filter((p): p is ConstraintProposal => p !== null);
  }

  /**
   * 审核提案
 *
   * 基于规则的审核（不消耗 Token）
   */
  review(proposal: ConstraintProposal): ProposalReviewResult {
    // 检查约束层级影响
    const constraint = this.findConstraint(proposal.constraintId);
    const level = constraint?.level;

    // Iron Law 修改需要谨慎
    if (level === 'iron_law' && proposal.type !== 'add_exception') {
      return {
        accepted: false,
        comment: 'Iron Law 约束的修改需要人工审核，建议仅添加例外条件',
        modifications: {
          type: 'add_exception',
        },
      };
    }

    // 高风险提案需要人工审核
    if (proposal.risk.level === 'high') {
      return {
        accepted: false,
        comment: '高风险提案需要人工审核',
      };
    }

    // 检查提案合理性
    if (!proposal.content.proposed || !proposal.content.description) {
      return {
        accepted: false,
        comment: '提案内容不完整',
      };
    }

    // 低风险 + 合理内容 → 自动接受
    if (proposal.risk.level === 'low' && proposal.implementation.testsRequired) {
      return {
        accepted: true,
        comment: '低风险提案，建议实施后验证效果',
      };
    }

    // 中风险 → 需要审核
    return {
      accepted: false,
      comment: '中等风险提案，建议人工审核后再实施',
    };
  }

  /**
   * 实施提案（返回实施建议，不自动修改代码）
   */
  implement(proposal: ConstraintProposal): {
    instructions: string[];
    filesToModify: string[];
    testsToRun: string[];
  } {
    const instructions: string[] = [];
    const filesToModify: string[] = [];
    const testsToRun: string[] = [];

    // 根据提案类型生成实施指导
    switch (proposal.type) {
      case 'add_exception':
        instructions.push(`在约束 ${proposal.constraintId} 的 exceptions 数组中添加新例外条件`);
        instructions.push(`例外条件: ${proposal.content.proposed}`);
        filesToModify.push('src/core/constraints/definitions.ts');
        testsToRun.push('src/__tests__/iron-laws.test.ts');
        break;

      case 'remove_exception':
        instructions.push(`从约束 ${proposal.constraintId} 的 exceptions 数组中移除例外条件`);
        instructions.push(`移除: ${proposal.content.proposed}`);
        filesToModify.push('src/core/constraints/definitions.ts');
        testsToRun.push('src/__tests__/iron-laws.test.ts');
        break;

      case 'adjust_trigger':
        instructions.push(`调整约束 ${proposal.constraintId} 的 trigger 条件`);
        instructions.push(`当前: ${proposal.content.current}`);
        instructions.push(`建议: ${proposal.content.proposed}`);
        filesToModify.push('src/core/constraints/definitions.ts');
        testsToRun.push('src/__tests__/iron-laws.test.ts');
        break;

      case 'change_level':
        instructions.push(`更改约束 ${proposal.constraintId} 的层级`);
        instructions.push(`当前: ${proposal.content.current}`);
        instructions.push(`建议: ${proposal.content.proposed}`);
        instructions.push(`注意：这会改变约束的强制程度`);
        filesToModify.push('src/core/constraints/definitions.ts');
        testsToRun.push('src/__tests__/iron-laws.test.ts');
        break;

      case 'modify_message':
        instructions.push(`修改约束 ${proposal.constraintId} 的提示消息`);
        filesToModify.push('src/core/constraints/definitions.ts');
        break;

      case 'new_constraint':
        instructions.push(`创建新约束 ${proposal.content.proposed.id}`);
        instructions.push(`层级: ${proposal.content.proposed.level}`);
        instructions.push(`规则: ${proposal.content.proposed.rule}`);
        filesToModify.push('src/core/constraints/definitions.ts');
        filesToModify.push('src/types/constraint.ts');
        testsToRun.push('src/__tests__/iron-laws.test.ts');
        break;
    }

    // 添加通用步骤
    instructions.push('运行测试验证变更');
    instructions.push('更新文档说明变更内容');

    return {
      instructions,
      filesToModify,
      testsToRun,
    };
  }

  /**
   * 保存提案
   */
  saveProposal(proposal: ConstraintProposal): void {
    const fs = require('fs');
    const path = require('path');

    const proposalFile = path.join(this.proposalsDir, `${proposal.id}.json`);

    // 确保目录存在
    if (!fs.existsSync(this.proposalsDir)) {
      fs.mkdirSync(this.proposalsDir, { recursive: true });
    }

    // 保存提案
    fs.writeFileSync(proposalFile, JSON.stringify(proposal, null, 2), 'utf-8');

    // 保存人类可读版本
    const mdFile = path.join(this.proposalsDir, `${proposal.id}.md`);
    fs.writeFileSync(mdFile, this.generateProposalMarkdown(proposal), 'utf-8');
  }

  /**
   * 加载提案
   */
  loadProposal(proposalId: string): ConstraintProposal {
    const fs = require('fs');
    const path = require('path');

    const proposalFile = path.join(this.proposalsDir, `${proposalId}.json`);
    const content = fs.readFileSync(proposalFile, 'utf-8');

    return JSON.parse(content) as ConstraintProposal;
  }

  /**
   * 列出所有提案
   */
  listProposals(status?: ConstraintProposal['status']): ConstraintProposal[] {
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(this.proposalsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.proposalsDir)
      .filter((f: string) => f.endsWith('.json'));

    const proposals = files.map((f: string) => {
      const content = fs.readFileSync(path.join(this.proposalsDir, f), 'utf-8');
      return JSON.parse(content) as ConstraintProposal;
    });

    if (status) {
      return proposals.filter((p: ConstraintProposal) => p.status === status);
    }

    return proposals;
  }

  /**
   * 更新提案状态
   */
  updateProposalStatus(
    proposalId: string,
    status: ConstraintProposal['status'],
    reviewComment?: string
  ): void {
    const proposal = this.loadProposal(proposalId);
    proposal.status = status;
    if (reviewComment) {
      proposal.reviewComment = reviewComment;
    }
    this.saveProposal(proposal);
  }

  // ========================================
  // 私有方法
  // ========================================

  /**
   * 映射建议类型到提案类型
   */
  private mapRecommendationType(type: string): ConstraintProposal['type'] {
    const map: Record<string, ConstraintProposal['type']> = {
      'add_exception': 'add_exception',
      'adjust_threshold': 'adjust_trigger',
      'modify_constraint': 'modify_message',
      'user_training': 'modify_message', // 用户培训不需要修改约束
    };
    return map[type] || 'modify_message';
  }

  /**
   * 生成提案内容
   */
  private generateProposalContent(
    diagnosis: Diagnosis,
    recommendation: Diagnosis['recommendations'][0]
  ): ConstraintProposal['content'] {
    const constraint = this.findConstraint(diagnosis.constraintId);

    switch (recommendation.type) {
      case 'add_exception':
        return {
          current: constraint?.exceptions || [],
          proposed: this.suggestException(diagnosis),
          description: `为约束 ${diagnosis.constraintId} 添加新例外条件`,
        };

      case 'adjust_threshold':
        return {
          current: constraint?.trigger,
          proposed: this.suggestTrigger(diagnosis),
          description: `调整约束 ${diagnosis.constraintId} 的触发条件`,
        };

      case 'modify_constraint':
        return {
          current: constraint?.message,
          proposed: this.suggestMessage(diagnosis),
          description: `修改约束 ${diagnosis.constraintId} 的提示消息`,
        };

      default:
        return {
          proposed: recommendation.content,
          description: recommendation.content,
        };
    }
  }

  /**
   * 建议例外条件
   */
  private suggestException(diagnosis: Diagnosis): string {
    // 根据诊断生成例外建议
    const constraintId = diagnosis.constraintId;

    // 基于约束类型的预设例外
    const presetExceptions: Record<string, string[]> = {
      'no_fix_without_root_cause': ['simple_typo', 'config_error', 'missing_config'],
      'no_code_without_test': ['config_file', 'type_definition', 'simple_accessor'],
      'simplest_solution_first': ['scalability_required', 'security_required', 'performance_required'],
    };

    const presets = presetExceptions[constraintId] || [];
    if (presets.length > 0) {
      return presets[0]; // 返回第一个预设例外
    }

    // 通用例外建议
    return `custom_exception_for_${constraintId}`;
  }

  /**
   * 建议触发条件
   */
  private suggestTrigger(diagnosis: Diagnosis): string {
    // 根据约束类型建议更精确的触发条件
    return `specific_trigger_for_${diagnosis.constraintId}`;
  }

  /**
   * 建议提示消息
   */
  private suggestMessage(diagnosis: Diagnosis): string {
    // 根据诊断生成更清晰的提示消息
    return `${diagnosis.rootCause.primary} - 建议检查约束定义`;
  }

  /**
   * 风险评估
   */
  private assessRisk(
    diagnosis: Diagnosis,
    recommendation: Diagnosis['recommendations'][0]
  ): ConstraintProposal['risk'] {
    // 根据影响程度和实施成本评估风险
    const severity = diagnosis.impact.severity;
    const cost = recommendation.implementationCost;

    if (severity === 'high' && cost === 'high') {
      return {
        level: 'high',
        description: '高影响 + 高成本，需要谨慎评估',
        rollbackPlan: '保留原约束定义，通过配置切换',
      };
    }

    if (severity === 'high' || cost === 'high') {
      return {
        level: 'medium',
        description: '影响较大或成本较高',
        rollbackPlan: '记录原值，必要时回滚',
      };
    }

    return {
      level: 'low',
      description: '低风险变更',
    };
  }

  /**
   * 估算实施信息
   */
  private estimateImplementation(constraintId: string): ConstraintProposal['implementation'] {
    return {
      files: ['src/core/constraints/definitions.ts'],
      linesChanged: 10, // 通常只需修改几行
      testsRequired: true,
    };
  }

  /**
   * 查找约束定义（经注入的 lookup；未注入时返回 null）
   */
  private findConstraint(constraintId: string): Constraint | null {
    return this.constraintLookup?.(constraintId) ?? null;
  }

  /**
   * 生成提案 Markdown
   */
  private generateProposalMarkdown(proposal: ConstraintProposal): string {
    const lines: string[] = [];

    lines.push(`# Constraint Proposal: ${proposal.id}`);
    lines.push('');
    lines.push(`- **Constraint**: ${proposal.constraintId}`);
    lines.push(`- **Type**: ${proposal.type}`);
    lines.push(`- **Status**: ${proposal.status}`);
    lines.push(`- **Proposed**: ${new Date(proposal.proposedAt).toISOString()}`);
    lines.push('');

    lines.push(`## Content`);
    lines.push('');
    lines.push(`**Description**: ${proposal.content.description}`);
    if (proposal.content.current) {
      lines.push(`**Current**: ${JSON.stringify(proposal.content.current)}`);
    }
    lines.push(`**Proposed**: ${JSON.stringify(proposal.content.proposed)}`);
    lines.push('');

    lines.push(`## Reasoning`);
    lines.push('');
    lines.push(proposal.reasoning);
    lines.push('');

    lines.push(`## Expected Outcome`);
    lines.push('');
    lines.push(proposal.expectedOutcome);
    lines.push('');

    lines.push(`## Risk Assessment`);
    lines.push('');
    lines.push(`- **Level**: ${proposal.risk.level}`);
    lines.push(`- **Description**: ${proposal.risk.description}`);
    if (proposal.risk.rollbackPlan) {
      lines.push(`- **Rollback**: ${proposal.risk.rollbackPlan}`);
    }
    lines.push('');

    lines.push(`## Implementation`);
    lines.push('');
    lines.push(`- **Files**: ${proposal.implementation.files.join(', ')}`);
    lines.push(`- **Lines Changed**: ~${proposal.implementation.linesChanged}`);
    lines.push(`- **Tests Required**: ${proposal.implementation.testsRequired ? 'Yes' : 'No'}`);

    return lines.join('\n');
  }
}

/**
 * 创建进化器
 */
export function createEvolver(
  proposalsDir?: string,
  constraintLookup?: ConstraintLookup
): ConstraintEvolver {
  return new ConstraintEvolver(proposalsDir, constraintLookup);
}