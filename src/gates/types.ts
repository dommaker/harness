/**
 * 门禁层私有类型 + GateResult 构造器
 *
 * 跨层消费的公共类型（GateResult / GateDecision / GateDecisionStatus /
 * BlacklistLevel / CommandBlacklistRule / PerformanceThresholds）正本在
 * `src/types/gate.ts`，此处 re-export 只是本层内部的便捷入口。
 */

import type {
  GateDecision,
  GateResult,
  PerformanceThresholds,
} from '../types/gate';
import type { RunEnv } from '../core/constraints/run-env';

export type {
  GateDecision,
  GateDecisionStatus,
  GateResult,
  BlacklistLevel,
  CommandBlacklistRule,
  PerformanceThresholds,
} from '../types/gate';

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
  details?: Record<string, unknown>
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
  details?: Record<string, unknown>
): GateResult {
  return gateResult(gate, true, message, startedAt, details);
}

/** 未通过报告 */
export function fail(
  gate: string,
  message: string,
  startedAt: number,
  details?: Record<string, unknown>
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
  details?: Record<string, unknown>
): GateResult {
  const reason = error instanceof Error ? error.message : String(error);
  return fail(gate, `${label}: ${reason}`, startedAt, details);
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
  /** 声明式顺序（以 gates/definitions.ts 定义表为准，config.yml 无覆盖口——gates.order 生效集已删，ADR-0002「后续变更」），小者先执行 */
  order: number;
  /** 决策协议：返回三态 GateDecision */
  evaluate(ctx: GateContext): Promise<GateDecision> | GateDecision;
}

/**
 * 门禁上下文：只带「这次在哪跑、跑什么」这类运行信息
 *
 * 配置一律走构造器（`ReviewGateConfig` 等），不要往这里加字段——
 * 本类型曾有 6 个无人读取的配置型字段与构造器配置平行，填了不生效。
 */
export interface GateContext {
  projectPath: string;
  taskId?: string;

  // Review Gate
  prNumber?: number;

  // Security Gate
  securityScanCommand?: string;

  // Performance Gate
  performanceThresholds?: PerformanceThresholds;

  // Contract Gate
  oldContractPath?: string;
  newContractPath?: string;

  // Command Gate
  command?: string;

  // Acceptance Gate
  tasksPath?: string;

  /**
   * 本 run 的运行级观察面（ADR-0023）。一条守卫链传同一枚 → 项目配置文件整链至多读一次；
   * 不传 = 各门禁自造一枚一次性观察面（判定不变，只是不共享读取）
   */
  runEnv?: RunEnv;
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
  scanCommand?: string;
  ignoreWarnings: boolean;
  ignoreDevDependencies: boolean;
  severityThreshold: 'low' | 'moderate' | 'high' | 'critical';
}

/**
 * 性能门禁配置
 */
export interface PerformanceGateConfig {
  thresholds: PerformanceThresholds;
}

/**
 * 契约门禁配置
 */
export interface ContractGateConfig {
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
 * 命令门禁配置
 *
 * `strict`（从不被判定读取）与 `customBlacklist`（零生产注入者，运行时扩展点是
 * `CommandGate.addRule()`）两个配置位已删除，裁决见 ADR-0024（#135）。
 */
export interface CommandGateConfig {
  /** 忽略的类别 */
  ignoreCategories?: string[];
}
