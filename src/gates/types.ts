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
import { errorMessage } from '../utils/error';

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
  const reason = errorMessage(error);
  return fail(gate, `${label}: ${reason}`, startedAt, details);
}

/**
 * 统一门禁接口（G1）
 *
 * 统一的是决策协议（id / evaluate → 三态决策），
 * 各门禁执行细节（gh pr view / 正则黑名单 / OpenAPI diff / benchmark…）私有。
 *
 * 注意：各实现 evaluate 收窄使用专属输入类型（`ReviewGateContext` 等），
 * 而当前没有经本接口多态调 evaluate 的生产消费者。TS 方法参数双变意味着
 * 若未来新增这种调用，基础 `GateContext` 不会替你校验专属必填字段
 * （如 `CommandGateContext.command`）——届时须先收紧接口形状/调用契约。
 */
export interface Gate {
  /** 门禁 id（与 gates/definitions.ts 定义一致，注册表闭环校验） */
  readonly id: string;
  /** 决策协议：返回三态 GateDecision */
  evaluate(ctx: GateContext): Promise<GateDecision> | GateDecision;
}

/**
 * 门禁上下文：只带全部门禁真正共享的运行信息（在哪跑 / 跑什么 / 本 run 观察面）
 *
 * P1.4 收窄：各门禁专属输入字段（prNumber / securityScanCommand /
 * performanceThresholds / oldContractPath / newContractPath / command /
 * tasksPath）已迁到各门禁自己的输入类型（`ReviewGateContext` 等），
 * 不再混进共享上下文。配置一律走构造器（`ReviewGateConfig` 等），
 * 不要往这里加字段——本类型曾有 6 个无人读取的配置型字段与构造器
 * 配置平行，填了不生效。
 */
export interface GateContext {
  projectPath: string;
  taskId?: string;

  /**
   * 本 run 的运行级观察面（ADR-0023）。一条守卫链传同一枚 → 项目配置文件整链至多读一次；
   * 不传 = 各门禁自造一枚一次性观察面（判定不变，只是不共享读取）
   */
  runEnv?: RunEnv;
}

/**
 * 审查门禁输入：PR 号存在时走 GitHub API，否则落本地 git 检查
 */
export interface ReviewGateContext extends GateContext {
  prNumber?: number;
}

/**
 * 安全门禁输入：本次扫描命令覆盖（优先级高于构造器 `scanCommand`，见 SecurityGate.scan）
 */
export interface SecurityGateContext extends GateContext {
  securityScanCommand?: string;
}

/**
 * 性能门禁输入：本次阈值覆盖（优先级高于构造器 `thresholds`，见 PerformanceGate.check）
 */
export interface PerformanceGateContext extends GateContext {
  performanceThresholds?: PerformanceThresholds;
}

/**
 * 契约门禁输入：新旧契约路径覆盖（缺省按构造器 `contractPath` 锚 projectPath）
 */
export interface ContractGateContext extends GateContext {
  oldContractPath?: string;
  newContractPath?: string;
}

/**
 * 命令门禁输入：待检命令（必填——evaluate 的判定对象就是它）
 */
export interface CommandGateContext extends GateContext {
  command: string;
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
 * 验收标准门禁输入
 */
export interface AcceptanceGateContext extends GateContext {
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
