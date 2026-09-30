/**
 * 门禁公共类型（gates/ 层被 cli/ 与包外消费的横切类型，自 gates/types.ts 归拢）
 *
 * 本层（src/types/）是零依赖公共类型层：本文件不得 import 任何内部模块。
 * 门禁协议本身（Gate / GateContext / 各门禁配置）仍留在 src/gates/types.ts——
 * 它们只被 gates 层内部消费；这里只收跨层消费的类型：
 * - GateResult / GateDecision / GateDecisionStatus：cli/gate-command.ts 的决策→命令映射
 * - CommandBlacklistRule / BlacklistLevel：cli `command` 命令与 pretool-use-hook
 * - PerformanceThresholds：cli `performance` 命令的旗帜装配
 */

/**
 * 门禁结果（报告结构）
 *
 * 统一 Gate 接口后 GateResult 仍是每个门禁产出的报告层；
 * 决策层见 GateDecision。
 */
export interface GateResult {
  gate: string;
  passed: boolean;
  message: string;
  /** 报告负载是开放袋（各门禁私有形状），读取方自行窄化 */
  details?: Record<string, unknown>;
  timestamp: string;
  duration?: number;
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
 * 决策对象由 decisionFromResult 浅冻结——不可变是
 * deny 单调语义的接口契约。
 */
export interface GateDecision {
  /** 三态决策 */
  status: GateDecisionStatus;
  /** 报告结构（GateResult 保留为报告层，不删） */
  result: GateResult;
}

/**
 * 黑名单级别：
 * - block: 禁止执行，直接拒绝
 * - warn: 允许执行，但记录警告
 * - audit: 允许执行，但记录审计日志
 */
export type BlacklistLevel = 'block' | 'warn' | 'audit';

/**
 * 命令黑名单规则
 */
export interface CommandBlacklistRule {
  id: string;
  pattern: RegExp;
  level: BlacklistLevel;
  message: string;
  category: string;
}

/**
 * 性能阈值（架构评审候选2：只留有真实现的维度——coverage 走 json-summary、
 * bundleSize 走 dist 目录测量；responseTime/memoryUsage/throughput 无真实现已删）
 */
export interface PerformanceThresholds {
  minCoverage?: number;       // %
  maxBundleSize?: number;     // KB
}
