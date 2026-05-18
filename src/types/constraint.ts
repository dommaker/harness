/**
 * 约束类型定义
 * 
 * 三层约束体系：
 * - Iron Laws：绝对禁止，无例外，违背即阻止执行
 * - Guidelines：优先建议，有例外，违背发警告但不阻止
 * - Tips：信息性提示，可忽略
 */

/**
 * 约束 ID
 */
export type ConstraintId = string;

/**
 * 约束层级
 */
export type ConstraintLevel = 'iron_law' | 'guideline' | 'tip';

/**
 * 约束触发条件
 */
/**
 * 约束触发器（开放扩展）
 *
 * 从硬编码 union type 改为 string，consumer 可传入任意 trigger。
 * 无需修改 harness 即可添加领域特定 trigger。
 *
 * 以下为推荐的抽象 trigger 常量。领域概念（如 deploy、
 * config_update 等）由 consumer 自行管理。
 */

export const CODE_IMPLEMENTATION = 'code_implementation' as const;
export const FILE_MODIFICATION = 'file_modification' as const;
export const FILE_CREATION = 'file_creation' as const;
export const FILE_DELETION = 'file_deletion' as const;
export const MODULE_CREATION = 'module_creation' as const;
export const MODULE_MODIFICATION = 'module_modification' as const;
export const MODULE_DELETION = 'module_deletion' as const;
export const MODULE_EXTENSION = 'module_extension' as const;
export const API_CHANGE = 'api_change' as const;
export const EXPORT_CHANGE = 'export_change' as const;
export const TEST_CREATION = 'test_creation' as const;
export const COMMIT = 'commit' as const;
export const PUSH = 'push' as const;
export const MERGE = 'merge' as const;
export const DESIGN_REQUEST = 'design_request' as const;
export const ARCHITECTURE_CHANGE = 'architecture_change' as const;

export type ConstraintTrigger = string;

/**
 * 约束定义
 */
export interface Constraint {
  /** 约束 ID */
  id: ConstraintId;
  
  /** 约束规则（英文） */
  rule: string;
  
  /** 约束消息（中文） */
  message: string;
  
  /** 约束层级 */
  level: ConstraintLevel;
  
  /** 触发条件（支持多个 trigger） */
  trigger: ConstraintTrigger | ConstraintTrigger[];
  
  /** 强制执行的技能/步骤 */
  enforcement: string;
  
  /** 约束描述 */
  description?: string;

  /** 软约束 prompt 注入（引导 Agent 行为的提示文本） */
  promptInjection?: string;

  /** 是否注入 Agent prompt（默认 iron_law=true, guideline=false） */
  injectPrompt?: boolean;

  /** 是否启用 */
  enabled?: boolean;

  /** 例外条件（仅 Guidelines 有效） */
  exceptions?: string[];
}

// ========================================
// 向后兼容的类型别名
// ========================================

/**
 * @deprecated 使用 ConstraintId 代替
 */
export type IronLawId = ConstraintId;

/**
 * @deprecated 使用 ConstraintLevel 代替
 */
export type IronLawSeverity = 'error' | 'warning' | 'info';

/**
 * @deprecated 使用 ConstraintTrigger 代替
 */
export type IronLawTrigger = ConstraintTrigger;

/**
 * @deprecated 使用 Constraint 代替
 */
export interface IronLaw extends Constraint {
  /** @deprecated 使用 level 代替 */
  severity?: IronLawSeverity;
}

/**
 * 约束检查结果
 */
export interface ConstraintResult {
  /** 约束 ID */
  id: ConstraintId;
  
  /** 约束层级 */
  level: ConstraintLevel;
  
  /** 是否满足 */
  satisfied: boolean;
  
  /** 约束定义 */
  constraint?: Constraint;
  
  /** 消息 */
  message?: string;
  
  /** 建议操作 */
  requiredAction?: string;
  
  /** 检查时间 */
  checkedAt: Date;
}

/**
 * @deprecated 使用 ConstraintResult 代替
 */
export interface IronLawResult extends ConstraintResult {
  /** @deprecated */
  law?: Constraint;
}

/**
 * 约束检查上下文
 */
export interface ConstraintContext {
  /** 当前操作类型 */
  operation: ConstraintTrigger;
  
  /** 工作流 ID */
  workflowId?: string;
  
  /** 步骤 ID */
  stepId?: string;
  
  /** 任务描述 */
  taskDescription?: string;
  
  /** 项目路径 */
  projectPath?: string;
  
  /** 会话 ID（用于追踪同一会话的多次检查） */
  sessionId?: string;
  
  /** 变更的文件列表 */
  changedFiles?: string[];
  
  /** 提交信息 */
  commitMessage?: string;
  
  /** 分支名称 */
  branch?: string;
  
  // ========================================
  // 前置条件检查
  // ========================================
  
  /** 是否有根本原因调查 */
  hasRootCauseInvestigation?: boolean;
  
  /** 是否有验证证据 */
  hasVerificationEvidence?: boolean;
  
  /** 是否有测试 */
  hasTest?: boolean;
  
  /** 是否有失败的测试 */
  hasFailingTest?: boolean;
  
  /** 是否已进行复用检查 */
  hasReuseCheck?: boolean;
  
  /** 复用检查结果 */
  reuseCheckResult?: {
    existingCapabilities: string[];
    canReuse: boolean;
    reuseRecommendation: string;
  };
  
  /** 是否只处理单个任务（用于 incremental_progress） */
  hasSingleTask?: boolean;
  
  /** 是否已验证外部能力（用于 verify_external_capability） */
  hasExternalCapabilityVerification?: boolean;

  /** 是否已对比需求验证（用于 no_implementation_without_requirement_review） */
  hasRequirementReview?: boolean;

  /** 是否有需求文档（用于 no_implementation_without_requirement） */
  hasRequirement?: boolean;

  /** 是否在 worktree 中执行（用于 must_use_worktree） */
  hasWorktree?: boolean;

  /** worktree 路径（用于 worktree 相关检查） */
  worktreePath?: string;

  /** 完成声明文本（用于 fuzzy/excuse 检查） */
  completionClaimText?: string;

  /** 是否完成两阶段审查（用于 two_stage_review_required） */
  hasTwoStageReview?: boolean;
  
  // ========================================
  // 例外条件（用于 Guidelines）
  // ========================================
  
  // simplest_solution_first 例外
  scalabilityRequired?: boolean;
  securityRequired?: boolean;
  performanceRequired?: boolean;
  reliabilityRequired?: boolean;
  
  // no_fix_without_root_cause 例外
  isSimpleTypo?: boolean;
  isConfigValueError?: boolean;
  isMissingConfig?: boolean;
  
  // no_code_without_test 例外
  isConfigFile?: boolean;
  isTypeDefinition?: boolean;
  isSimpleAccessor?: boolean;
  isPureDisplayComponent?: boolean;
  
  // no_any_type 例外
  isJsonParseResult?: boolean;
  isThirdPartyNoTypes?: boolean;
  isLegacyMigration?: boolean;
  
  // capability_sync 例外
  isInternalRefactor?: boolean;
  isBugFixOnly?: boolean;
  isPerformanceOptimization?: boolean;
  
  // no_simplification_without_approval 例外
  isRedundantCodeCleanup?: boolean;
  isSameEffectRefactor?: boolean;
  isUnusedCodeRemoval?: boolean;

  // 设计决策例外
  isExplicitInstruction?: boolean;
  isEmergencyFix?: boolean;
  isExistingDesign?: boolean;

  // 外部依赖相关
  isExternalDependency?: boolean;
  
  /** 例外理由说明 */
  exceptionReason?: string;
  
  /** 执行上下文 */
  executionContext?: any;
}

/**
 * @deprecated 使用 ConstraintContext 代替
 */
export type IronLawContext = ConstraintContext;

/**
 * 约束违规错误
 */
export class ConstraintViolationError extends Error {
  public readonly result: ConstraintResult;

  constructor(result: ConstraintResult) {
    super(result.message || 'Constraint violation');
    this.name = 'ConstraintViolationError';
    this.result = result;
  }
}

/**
 * @deprecated 使用 ConstraintViolationError 代替
 */
export class IronLawViolationError extends ConstraintViolationError {
  constructor(result: ConstraintResult) {
    super(result);
    this.name = 'IronLawViolationError';
  }
}

/**
 * 三层约束检查结果
 */
export interface ConstraintCheckResult {
  /** 铁律检查结果（必须全部通过） */
  ironLaws: ConstraintResult[];
  
  /** 指导原则检查结果（警告，不阻止） */
  guidelines: ConstraintResult[];
  
  /** 提示检查结果（仅提示） */
  tips: ConstraintResult[];
  
  /** 是否通过（铁律全部通过） */
  passed: boolean;
  
  /** 警告数量 */
  warningCount: number;
  
  /** 提示数量 */
  tipCount: number;
}
