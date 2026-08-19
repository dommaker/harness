/**
 * 约束类型定义
 *
 * kind 二元模型（ADR-0001）：
 * - check：必须带真实 checker，参与运行时检查与 trace 统计
 *   - iron_law：绝对禁止，无例外，违背即阻止执行
 *   - guideline：优先建议，违背发警告但不阻止
 * - prompt：纯文本提示，仅参与 prompt 注入，不占检查位、不产生 trace
 */

/**
 * 约束 ID
 */
export type ConstraintId = string;

/**
 * 约束类别：check = 可执行检查；prompt = 纯文本注入
 */
export type ConstraintKind = 'check' | 'prompt';

/**
 * 约束层级
 *
 * check 层只使用 'iron_law' | 'guideline'；prompt 类统一为 'prompt'。
 */
export type ConstraintLevel = 'iron_law' | 'guideline' | 'prompt';

/**
 * 约束触发条件（开放扩展）
 *
 * 从硬编码 union type 改为 string，consumer 可传入任意 trigger。
 * 无需修改 harness 即可添加领域特定 trigger。
 */
export type ConstraintTrigger = string;

/**
 * 约束定义
 */
export interface Constraint {
  /** 约束 ID */
  id: ConstraintId;

  /**
   * 约束类别（ADR-0001）：
   * - check：必须带真实 checker，参与运行时检查
   * - prompt：纯文本提示，仅参与注入，不执行 checker
   */
  kind: ConstraintKind;

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

  /**
   * 适用场景标签（prompt 类专用，如 'agent-skill'、'llm-app'）。
   * 未标注表示通用场景。消费端（init 注入 / studio 路由）可按标签过滤。
   */
  appliesTo?: string[];
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

  /**
   * 是否跳过评估（ADR-0001 三态语义）
   *
   * skip = 约定未采用（存在性探测未命中）或证据 flag 未接线（undefined）。
   * skip 时 satisfied 恒为 true（fail-open，不阻断、不计警告），
   * 但不计入 pass/fail 统计；trace 记录为 result: 'skip'。
   */
  skipped?: boolean;
  
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
 * 约束检查上下文
 */
export interface ConstraintContext {
  /** 当前操作类型 */
  operation: ConstraintTrigger;

  /**
   * 附加触发条件（ADR-0001：detectTrigger 的次级推断）
   *
   * pre-commit 变更包含代码文件时，operation 保持主推断（如 module_modification），
   * code_implementation 记录在此；匹配约束时 operation 与 extraTriggers 一并参与。
   */
  extraTriggers?: ConstraintTrigger[];
  
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

  /** 是否已通过诊断→修复闸门（设计方案已确认） */
  hasPlanApproval?: boolean;

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
  
  /** 是否已验证外部能力（对应约束已降级为 prompt，字段保留兼容） */
  hasExternalCapabilityVerification?: boolean;

  /** 是否已对比需求验证（review 变体已并入主约束，字段保留兼容） */
  hasRequirementReview?: boolean;

  /** 是否有需求文档（用于 no_implementation_without_requirement） */
  hasRequirement?: boolean;

  /** 是否在 worktree 中执行（对应约束已移出内置，字段保留兼容） */
  hasWorktree?: boolean;

  /** worktree 路径（用于 worktree 相关检查） */
  worktreePath?: string;

  /** 完成声明文本（对应检查已并入 prompt 层，字段保留兼容） */
  completionClaimText?: string;

  /** 是否完成两阶段审查（对应约束已移出内置，字段保留兼容） */
  hasTwoStageReview?: boolean;

  /** 执行上下文 */
  executionContext?: any;
}

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
 * 约束检查结果（check 层）
 */
export interface ConstraintCheckResult {
  /** 铁律检查结果（必须全部通过） */
  ironLaws: ConstraintResult[];
  
  /** 指导原则检查结果（警告，不阻止） */
  guidelines: ConstraintResult[];
  
  /** 是否通过（铁律全部通过） */
  passed: boolean;
  
  /** 警告数量 */
  warningCount: number;
}

/**
 * studio 兼容别名(P0 护栏):等价于 ConstraintContext
 */
export type IronLawContext = ConstraintContext;
