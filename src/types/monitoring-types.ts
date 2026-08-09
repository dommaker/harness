/**
 * 监控域类型（诊断）
 *
 * 原定义位于 monitoring/constraint-doctor.ts，
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
