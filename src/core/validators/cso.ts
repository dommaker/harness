/**
 * CSO (Concise Skill Optimization) 验证器（简化版）
 */

import type { WorkflowMeta, StepMeta, ToolMeta } from '../../types/cso';

/**
 * CSO 验证结果
 */
export interface CSOValidationResult {
  valid: boolean;
  message?: string;
  suggestion?: string;
  issues?: CSOIssue[];
}

/**
 * CSO 问题
 */
export interface CSOIssue {
  type: 'workflow_summary' | 'missing_trigger' | 'too_long';
  message: string;
}

/**
 * CSO 验证器
 */
export class CSOValidator {
  private static instance: CSOValidator;

  // 工作流总结关键词（不应出现在 description 中）
  private static WORKFLOW_KEYWORDS = [
    'step 1', 'step 2', 'phase', 'first', 'then', 'after',
    '流程', '步骤', '首先', '然后',
  ];

  // 触发条件关键词（应该出现在 description 中）
  private static TRIGGER_KEYWORDS = [
    'use when', 'use for', '用于', '当', '适用于', '触发',
  ];

  private constructor() {}

  static getInstance(): CSOValidator {
    if (!CSOValidator.instance) {
      CSOValidator.instance = new CSOValidator();
    }
    return CSOValidator.instance;
  }

  /**
   * 验证 Workflow 的 description
   */
  validateWorkflow(workflow: WorkflowMeta): CSOValidationResult {
    return this.validateDescription(workflow.description, 'workflow');
  }

  /**
   * 验证 Step 的 description
   */
  validateStep(step: StepMeta): CSOValidationResult {
    return this.validateDescription(step.description, 'step');
  }

  /**
   * 验证 Tool 的 description
   */
  validateTool(tool: ToolMeta): CSOValidationResult {
    return this.validateDescription(tool.description, 'tool');
  }

  /**
   * 验证描述
   */
  private validateDescription(description: string, _type: string): CSOValidationResult {
    const issues: CSOIssue[] = [];

    // 检查是否有工作流总结关键词
    const hasWorkflowKeywords = CSOValidator.WORKFLOW_KEYWORDS.some(k => 
      description.toLowerCase().includes(k.toLowerCase())
    );

    if (hasWorkflowKeywords) {
      issues.push({
        type: 'workflow_summary',
        message: `描述包含工作流总结关键词，应只描述触发条件`,
      });
    }

    // 检查是否有触发条件关键词
    const hasTriggerKeywords = CSOValidator.TRIGGER_KEYWORDS.some(k =>
      description.toLowerCase().includes(k.toLowerCase())
    );

    if (!hasTriggerKeywords) {
      issues.push({
        type: 'missing_trigger',
        message: `描述缺少触发条件关键词`,
      });
    }

    // 检查长度
    if (description.length > 200) {
      issues.push({
        type: 'too_long',
        message: `描述过长 (${description.length} 字符)，建议不超过 200 字符`,
      });
    }

    const valid = issues.length === 0;
    let suggestion: string | undefined;

    if (!valid) {
      suggestion = `建议格式: "用于 [场景] 时，[做什么]"`;
    }

    return {
      valid,
      issues,
      message: valid ? '符合 CSO 格式' : '不符合 CSO 格式',
      suggestion,
    };
  }
}