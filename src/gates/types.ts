/**
 * 门禁类型定义 + GateResult 构造器
 */

/**
 * 门禁结果（报告结构，保留）
 *
 * 统一 Gate 接口后 GateResult 仍是每个门禁产出的报告层；
 * 决策层见 GateDecision。
 */
export interface GateResult {
  gate: string;
  passed: boolean;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
  duration?: number;
}

/**
 * GateResult 构造器：报告层的唯一落点
 *
 * gate/passed/message 逐次手写最容易漏的是 duration（无类型可救，字段是可选的）；
 * 时间戳与耗时口径也由此统一。无 details 时不出该键（与手写形状一致）。
 */
export function gateResult(
  gate: string,
  passed: boolean,
  message: string,
  startedAt: number,
  details?: Record<string, any>
): GateResult {
  return {
    gate,
    passed,
    message,
    ...(details ? { details } : {}),
    timestamp: new Date().toISOString(),
    duration: Date.now() - startedAt,
  };
}

/** 通过报告 */
export function pass(
  gate: string,
  message: string,
  startedAt: number,
  details?: Record<string, any>
): GateResult {
  return gateResult(gate, true, message, startedAt, details);
}

/** 未通过报告 */
export function fail(
  gate: string,
  message: string,
  startedAt: number,
  details?: Record<string, any>
): GateResult {
  return gateResult(gate, false, message, startedAt, details);
}

/**
 * 异常报告：message = `${label}: ${原因}`
 *
 * 非 Error 抛出物按 String() 取原因（原 `error.message` 会得到 undefined）。
 */
export function fromError(
  gate: string,
  label: string,
  error: unknown,
  startedAt: number,
  details?: Record<string, any>
): GateResult {
  const reason = error instanceof Error ? error.message : String(error);
  return fail(gate, `${label}: ${reason}`, startedAt, details);
}

/**
 * 门禁决策三态（守卫/门禁统一，G1）
 *
 * - deny：阻断。单调语义——一旦出现，下游门禁不得改回 allow。
 * - abstain：弃权/放行。不阻断，也不否决。
 * - ask：需要人裁决。枚举预留，暂无实现；无实现时 fail-closed 按 deny 计。
 */
export type GateDecisionStatus = 'deny' | 'abstain' | 'ask';

/**
 * 门禁决策：统一 Gate 接口的返回值
 *
 * status 是三态决策；result 携带 GateResult 报告结构。
 * 决策对象由 decisionFromResult / runGates 浅冻结——不可变是
 * deny 单调语义的接口契约。
 */
export interface GateDecision {
  /** 三态决策 */
  status: GateDecisionStatus;
  /** 报告结构（GateResult 保留为报告层，不删） */
  result: GateResult;
}

/**
 * 统一门禁接口（G1）
 *
 * 统一的是决策协议（id / 声明式 order / evaluate → 三态决策），
 * 各门禁执行细节（gh pr view / 正则黑名单 / OpenAPI diff / benchmark…）私有。
 */
export interface Gate {
  /** 门禁 id（与 gates/definitions.ts 定义一致，注册表闭环校验） */
  readonly id: string;
  /** 声明式顺序（config.yml `gates.order` 可覆盖），小者先执行 */
  order: number;
  /** 决策协议：返回三态 GateDecision */
  evaluate(ctx: GateContext): Promise<GateDecision> | GateDecision;
}

/**
 * 门禁上下文
 */
export interface GateContext {
  projectId: string;
  taskId?: string;
  projectPath: string;
  
  // Review Gate
  prNumber?: number;
  minReviewers?: number;
  reviewers?: string[];
  
  // Security Gate
  securityScanCommand?: string;
  ignoreWarnings?: boolean;
  
  // Performance Gate
  performanceThresholds?: PerformanceThresholds;
  benchmarkCommand?: string;
  
  // Contract Gate
  oldContractPath?: string;
  newContractPath?: string;
  openApiSpec?: string;

  // Command Gate
  command?: string;

  // Acceptance Gate
  tasksPath?: string;
  
  // 通用
  timeout?: number;
}

/**
 * 性能阈值
 */
export interface PerformanceThresholds {
  maxResponseTime?: number;   // ms
  maxMemoryUsage?: number;    // MB
  minCoverage?: number;       // %
  maxBundleSize?: number;     // KB
  minThroughput?: number;     // req/s
}

/**
 * 审查门禁配置
 */
export interface ReviewGateConfig {
  minReviewers: number;
  requireApproval: boolean;
  blockOnChangesRequested: boolean;
  allowedReviewers?: string[];
}

/**
 * 安全门禁配置
 */
export interface SecurityGateConfig {
  enabled: boolean;
  scanCommand?: string;
  ignoreWarnings: boolean;
  ignoreDevDependencies: boolean;
  severityThreshold: 'low' | 'moderate' | 'high' | 'critical';
}

/**
 * 性能门禁配置
 */
export interface PerformanceGateConfig {
  enabled: boolean;
  benchmarkCommand?: string;
  thresholds: PerformanceThresholds;
  warmupRuns: number;
  measureRuns: number;
}

/**
 * 契约门禁配置
 */
export interface ContractGateConfig {
  enabled: boolean;
  strict: boolean;
  allowBreakingChanges: boolean;
  contractPath?: string;
}

/**
 * 验收标准门禁配置（单一正本，harness#101：并入原 acceptance.ts 宽版的 e2e 字段）
 */
export interface SpecAcceptanceGateConfig {
  /** tasks.yml 路径；相对值按 check 上下文的 projectPath 解析，缺省 `<projectPath>/tasks.yml` */
  tasksPath?: string;
  /** 是否检查所有任务 */
  checkAllTasks?: boolean;
  /** 自定义验收条件 */
  customAcceptanceCriteria?: Record<string, (task: any) => Promise<boolean>>;
  /** E2E 测试命令模板 */
  e2eTestCommand?: string;
  /** E2E 测试超时时间（毫秒） */
  e2eTestTimeout?: number;
  /** 项目路径 */
  projectPath?: string;
}

/**
 * 验收标准门禁上下文
 */
export interface AcceptanceGateContext {
  /** 项目路径 */
  projectPath: string;
  /** 任务 ID */
  taskId?: string;
  /** tasks.yml 路径；相对值按 projectPath 解析 */
  tasksPath?: string;
}

/**
 * 验收标准（旧格式，向后兼容）
 */
export interface AcceptanceCriteria {
  id: string;
  description: string;
  type: 'manual' | 'automated' | 'test';
  required: boolean;
  checked?: boolean;
  notes?: string;
}

/**
 * 命令黑名单规则
 */
export interface CommandBlacklistRule {
  id: string;
  pattern: RegExp;
  level: 'block' | 'warn' | 'audit';
  message: string;
  category: string;
}

/**
 * 命令门禁配置
 */
export interface CommandGateConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** 严格模式（warn 也阻止） */
  strict?: boolean;
  /** 自定义黑名单规则 */
  customBlacklist?: CommandBlacklistRule[];
  /** 忽略的类别 */
  ignoreCategories?: string[];
}
