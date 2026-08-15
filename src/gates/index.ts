/**
 * 门禁系统导出
 * 
 * 统一导出所有门禁类型
 */

// 类型导出
export type {
  GateResult,
  GateContext,
  Gate,
  GateDecision,
  GateDecisionStatus,
  PerformanceThresholds,
  ReviewGateConfig,
  SecurityGateConfig,
  PerformanceGateConfig,
  ContractGateConfig,
  SpecAcceptanceGateConfig,
  AcceptanceGateContext,
  AcceptanceCriteria,
  CommandBlacklistRule,
  CommandGateConfig,
} from './types';

// ========================================
// 统一门禁协议（G1）
// ========================================

/**
 * 门禁决策构造：GateResult 报告 → 三态 GateDecision（浅冻结）
 */
export { decisionFromResult } from './decision';

/**
 * 门禁定义表（定义即注册的单一定义源；bin/harness.js 注册表驱动生成 CLI）
 */
export { GATE_DEFINITIONS, type GateDefinition, type GateCliDefinition, type GateCliOption } from './definitions';

/**
 * 门禁注册表（定义↔实现双向闭环，加载期抛错）+ getGate 引用闭环
 */
export { getGate, listRegisteredGates, registeredGateCount, assertGateRegistryClosed } from './registry';

/**
 * 门禁执行器：deny 单调 + ask fail-closed
 */
export { runGates, type GateRunResult } from './runner';

/**
 * 生效门禁集：config.yml gates.order / gates.<id>.enabled 声明式裁剪
 */
export { getEffectiveGates, type GatesConfig } from './effective-gates';

/**
 * checker-as-guard 接线点：ConstraintCheck → Gate（studio #129 随动）
 */
export { createCheckerGate } from './checker-gate';


// 门禁类导出
export { ReviewGate } from './review';
export { SecurityGate } from './security';
export { PerformanceGate } from './performance';
export { ContractGate } from './contract';
export { SpecAcceptanceGate } from './acceptance';
export { CommandGate, createCommandGate, getCommandGate, isCommandAllowed, getCommandRiskLevel, DEFAULT_COMMAND_BLACKLIST } from './command';

// 便捷工厂函数
import { ReviewGate } from './review';
import { SecurityGate } from './security';
import { PerformanceGate } from './performance';
import { ContractGate } from './contract';
import { SpecAcceptanceGate } from './acceptance';
import type {
  ReviewGateConfig,
  SecurityGateConfig,
  PerformanceGateConfig,
  ContractGateConfig,
  SpecAcceptanceGateConfig,
} from './types';

export function createReviewGate(config?: Partial<ReviewGateConfig>): ReviewGate {
  return new ReviewGate(config);
}

export function createSecurityGate(config?: Partial<SecurityGateConfig>): SecurityGate {
  return new SecurityGate(config);
}

export function createPerformanceGate(config?: Partial<PerformanceGateConfig>): PerformanceGate {
  return new PerformanceGate(config);
}

export function createContractGate(config?: Partial<ContractGateConfig>): ContractGate {
  return new ContractGate(config);
}

export function createSpecAcceptanceGate(config?: Partial<SpecAcceptanceGateConfig>): SpecAcceptanceGate {
  return new SpecAcceptanceGate(config);
}

// CommandGate 已在 command.ts 中导出 createCommandGate
