/**
 * 约束类型定义
 *
 * severity 显式模型（ADR-0029，取代 ADR-0001 的三层命名与 kind 二元模型）：
 * - severity 直接写死在定义上：error = 违规即阻断；warning = 违规告警不阻断；
 *   info = 仅记录
 * - 纯文本提示层（kind='prompt' / promptInjection / 注入段渲染）已整体关停，
 *   文本规则由消费方手写治理段承接
 *
 * channel 通道模型（ADR-0035，两轴：channel=后果轴、checker 来源=判定轴）：
 * - gate（缺省）：硬门禁，必须带真实 checker，参与运行时检查与 trace 统计
 * - workflow：流程机制承载，无 checker，不进检查分发
 * - discipline：拦不住但数得出的登记记录，无 checker，harness 不渲染、不注入、
 *   不执行，供消费方做信号计数；晋升毕业后原地翻 channel 回 gate
 */

/**
 * 约束 ID
 */
export type ConstraintId = string;

/**
 * 约束类别（ADR-0029 收窄为单值）：check = 可执行检查
 */
export type ConstraintKind = 'check';

/**
 * 约束严重性（显式字段，取代三层 level 命名）
 */
export type ConstraintSeverity = 'error' | 'warning' | 'info';

/**
 * 约束通道（ADR-0035，后果轴；与探测器来源的判定轴正交）
 *
 * - gate：硬门禁——带 checker、违规按 severity 阻断/告警（缺省通道，现有行为）
 * - workflow：流程机制承载——无 checker，由 CI/拆票等流程结构兜住，不进检查分发
 * - discipline：拦不住但数得出——无 checker 的登记记录，harness 永不渲染、
 *   永不注入、永不执行，仅供消费方（如 studio）做代理信号计数；
 *   超阈值晋升毕业后原地翻回 gate（补上 checker）
 */
export type ConstraintChannel = 'gate' | 'workflow' | 'discipline';

/**
 * 约束触发条件（开放扩展）
 *
 * 从硬编码 union type 改为 string，consumer 可传入任意 trigger。
 * 无需修改 harness 即可添加领域特定 trigger。
 */
export type ConstraintTrigger = string;

/**
 * 约束来源（ADR-0033 两层约束模型）
 *
 * - builtin：内置约束（definitions/ 字面量定义，checker 按约束 id 注册查找）
 * - app：应用层约束（应用仓 `.harness/constraints.yml` 定义，checker 按模板 id +
 *   params 实例化）；缺省 builtin
 */
export type ConstraintSource = 'builtin' | 'app';

/**
 * 约束定义
 */
export interface Constraint {
  /** 约束 ID */
  id: ConstraintId;

  /**
   * 约束类别（ADR-0029）：恒为 'check'；
   * 纯文本提示（kind='prompt'）已随文本注入层一并关停
   */
  kind: ConstraintKind;

  /**
   * 约束通道（ADR-0035）：缺省 'gate'
   *
   * gate 通道必须带 checker（注册表闭环收窄后的口径）；workflow/discipline
   * 通道允许无 checker——不进入检查分发、不触发闭环抛错、harness 不渲染不注入
   */
  channel?: ConstraintChannel;

  /** 约束规则（英文） */
  rule: string;
  
  /** 约束消息（中文） */
  message: string;
  
  /** 约束严重性：error = 违规即阻断；warning = 违规告警不阻断；info = 仅记录 */
  severity: ConstraintSeverity;
  
  /** 触发条件（支持多个 trigger） */
  trigger: ConstraintTrigger | ConstraintTrigger[];
  
  /** 强制执行的技能/步骤 */
  enforcement: string;
  
  /** 约束描述 */
  description?: string;

  /** 是否启用 */
  enabled?: boolean;

  /**
   * 约束来源（ADR-0033）：缺省 builtin
   *
   * app = 应用层约束（应用仓 `.harness/constraints.yml` 定义）；
   * report/退休/提案据此区分来源
   */
  source?: ConstraintSource;

  /**
   * 填空式 checker 模板 id（仅 source='app' 使用；仅 channel='gate' 必填）
   *
   * 内置约束省略 = checker 按约束 id 在内置注册表查找；应用层约束按模板 id
   * 在模板注册表（checkers/index.ts TEMPLATES）查找并带 params 实例化
   */
  checker?: string;

  /** 模板参数（仅 source='app' 使用，形状由各模板的 validateParams 校验） */
  params?: Record<string, unknown>;
}

/**
 * 约束检查结果
 */
export interface ConstraintResult {
  /** 约束 ID */
  id: ConstraintId;
  
  /** 约束严重性 */
  severity: ConstraintSeverity;
  
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

  /**
   * 证据行（harness#119）
   *
   * checker 经 CheckDetail 返回的具体判定依据（如未登记的文件路径）。
   * 违规时随 message 一并展示；满足但非空时为「提示」（不进 pass/fail 统计）。
   * skip 恒为空——未评估不得留下证据行。
   */
  evidence?: string[];

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
  
  /** 是否只处理单个任务（证据标志，当前无内置 checker 消费，供自定义约束用） */
  hasSingleTask?: boolean;
  
  /** 是否有需求文档（证据标志，当前无内置 checker 消费，供自定义约束用） */
  hasRequirement?: boolean;

  /** worktree 路径（用于 worktree 相关检查） */
  worktreePath?: string;
}

/**
 * 约束违规错误
 */
export class ConstraintViolationError extends Error {
  public readonly result: ConstraintResult;

  constructor(result: ConstraintResult) {
    // severity='error' 的违规在 checkConstraints 处直接 throw，CLI 的结构化输出块
    // 走不到这里，error.message 是判定证据唯一的外溢面（harness#119）
    const detail = result.evidence?.length
      ? `：\n${result.evidence.map((line) => `  - ${line}`).join('\n')}`
      : '';
    super(`${result.message || 'Constraint violation'}${detail}`);
    this.name = 'ConstraintViolationError';
    this.result = result;
  }
}

/**
 * 约束检查结果（按 severity 分桶）
 */
export interface ConstraintCheckResult {
  /** severity='error' 的检查结果（必须全部通过） */
  errors: ConstraintResult[];
  
  /** severity='warning' 的检查结果（警告，不阻止） */
  warnings: ConstraintResult[];
  
  /** 是否通过（error 级全部通过） */
  passed: boolean;
  
  /** 警告数量 */
  warningCount: number;
}

/**
 * studio 兼容别名(P0 护栏):等价于 ConstraintContext
 */
export type IronLawContext = ConstraintContext;
