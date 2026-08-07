/**
 * 监控域类型（诊断 / 提案）
 *
 * 原定义位于 monitoring/constraint-doctor.ts 与 monitoring/constraint-evolver.ts，
 * 但被 types/index.ts 反向再导出（类型层依赖业务模块，分层倒挂）。
 * 工单 14 将类型定义归位到 types 层，monitoring 改从 types 导入。
 */

import type { ExecutionTrace } from './trace';

/**
 * 诊断结果
 */
export interface Diagnosis {
  /** 异常 ID */
  anomalyId: string;

  /** 约束 ID */
  constraintId: string;

  /** 诊断时间 */
  diagnosedAt: number;

  /** 根因分析 */
  rootCause: {
    /** 主要原因 */
    primary: string;

    /** 次要原因 */
    secondary?: string[];

    /** 相关 traces */
    evidence: ExecutionTrace[];
  };

  /** 影响评估 */
  impact: {
    /** 影响程度 */
    severity: 'low' | 'medium' | 'high';

    /** 影响范围 */
    scope: 'single_project' | 'multiple_projects' | 'team';

    /** 用户影响 */
    userImpact: string;
  };

  /** 改进建议 */
  recommendations: {
    /** 建议类型 */
    type: 'add_exception' | 'adjust_threshold' | 'modify_constraint' | 'user_training';

    /** 建议内容 */
    content: string;

    /** 预期效果 */
    expectedOutcome: string;

    /** 实施成本 */
    implementationCost: 'low' | 'medium' | 'high';
  }[];

  /** 是否需要变更 */
  needsChange: boolean;

  /** 紧急程度 */
  urgency: 'low' | 'medium' | 'high';
}

/**
 * 约束提案
 */
export interface ConstraintProposal {
  /** 提案 ID */
  id: string;

  /** 提案时间 */
  proposedAt: number;

  /** 来源诊断 */
  diagnosisId: string;

  /** 约束 ID */
  constraintId: string;

  /** 提案类型 */
  type: 'add_exception' | 'remove_exception' | 'adjust_trigger' | 'change_level' | 'modify_message' | 'new_constraint';

  /** 提案内容 */
  content: {
    /** 当前值（如果有） */
    current?: any;

    /** 建议值 */
    proposed: any;

    /** 变更描述 */
    description: string;
  };

  /** 理由 */
  reasoning: string;

  /** 预期效果 */
  expectedOutcome: string;

  /** 风险评估 */
  risk: {
    /** 风险等级 */
    level: 'low' | 'medium' | 'high';

    /** 风险描述 */
    description: string;

    /** 回滚方案 */
    rollbackPlan?: string;
  };

  /** 实施信息 */
  implementation: {
    /** 改动文件 */
    files: string[];

    /** 改动量估计 */
    linesChanged: number;

    /** 测试要求 */
    testsRequired: boolean;
  };

  /** 状态 */
  status: 'proposed' | 'reviewing' | 'accepted' | 'rejected' | 'implemented';

  /** 审核意见 */
  reviewComment?: string;
}

/**
 * 提案审核结果
 */
export interface ProposalReviewResult {
  /** 是否接受 */
  accepted: boolean;

  /** 审核意见 */
  comment: string;

  /** 修改建议（如果拒绝） */
  modifications?: Partial<ConstraintProposal>;
}
