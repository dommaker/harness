/**
 * @dommaker/harness - 主入口
 * 
 * 通用工程约束框架
 * 
 * 约束体系（ADR-0001 kind 二元）：
 * - check：可执行检查（Iron Laws 阻断 / Guidelines 告警）
 * - prompt：纯文本注入，不参与检查
 * 
 * 门禁系统：
 * - PassesGate：测试门控
 * - ReviewGate：审查门禁
 * - SecurityGate：安全门禁
 * - PerformanceGate：性能门禁
 * - ContractGate：契约门禁
 * - CheckpointValidator：检查点验证
 */

// ========================================
// 类型导出
// ========================================
export * from './types';

// ========================================
// 核心功能导出
// ========================================
export * from './core';

// ========================================
// 门禁系统导出
// ========================================
export * from './gates';

// ========================================
// 监控导出
// ========================================
export * from './monitoring';

// ========================================
// 失败处理导出
// ========================================
export * from './failure';

// ========================================
// Spec 检查导出
// ========================================
export * from './spec/annotation-checker';

// ========================================
// 上下文管理导出
// ========================================
export * from './context';

// ========================================
// 知识引擎导出
// ========================================
export * from './knowledge';

// ========================================
// 安全护栏导出
// ========================================
export * from './safety';

// ========================================
// 验证循环导出
// ========================================
export * from './verification';

// ========================================
// Completion Checkers 导出（T7-E1，studio#160）
// WU 收尾软观测三纯判定函数：tdd-chain / phase-format / contract-presence。
// 纯函数直接 export，不进 ConstraintCheck 闭环注册表。
// ========================================
export * from './completion-checkers';

// ========================================
// Dashboard 数据导出
// ========================================
export * from './dashboard';

// ========================================
// 工具路径导出
// ========================================
export * from './tools';

// ========================================
// Hooks 管线导出（Phase 1）
// ========================================
export * from './hooks';

// ========================================
// Agent 生命周期导出
// ========================================
export * from './agents';

// ========================================
// 预设导出
// ========================================
export * from './presets';

// ========================================
// 约束缓存与渲染导出（H6/G5-G6，#31 收编）
// ========================================
export { CheckCache } from './core/constraints/check-cache';
export type { CheckCacheConfig, CheckSamplingConfig } from './core/constraints/check-cache';
export { renderConstraintsByTrigger } from './core/constraints/agent-prompt-renderer';
export type { RenderConstraintsByTriggerOptions } from './core/constraints/agent-prompt-renderer';

// ========================================
// 便捷 API
// ========================================

import { constraintChecker } from './core/constraints/checker';
import { getTraceCollector } from './monitoring/traces';
import type { ConstraintContext, ConstraintCheckResult, ConstraintTrigger } from './types/constraint';
import { constraintInterceptor } from './core/constraints/interceptor';
import type { EnforcementExecutor, EnforcementId, InterceptionResult } from './types/enforcement';

// 工单 15：checker 的 trace 记录改为注入式，根入口在此接入真实收集器（保持既有行为）
constraintChecker.setTraceRecorder(getTraceCollector());

/** 约束拦截器单例，用于注册 enforcement executor 和拦截操作 */
export const interceptor = constraintInterceptor;

/**
 * 拦截操作 — 在操作执行前检查约束
 * @param trigger - 触发条件
 * @param context - 约束上下文
 * @returns 拦截结果（是否通过、违规列表）
 */
export async function interceptOperation(
  trigger: ConstraintTrigger,
  context: ConstraintContext
): Promise<InterceptionResult> {
  return constraintInterceptor.intercept(trigger, context);
}

/**
 * 声明操作意图 — 声明即将执行的操作，但不执行检查
 * @param trigger - 触发条件
 * @param context - 约束上下文
 */
export async function claimOperation(
  trigger: ConstraintTrigger,
  context: ConstraintContext
): Promise<void> {
  return constraintInterceptor.claim(trigger, context);
}

/**
 * 注册 enforcement executor — 将 enforcement ID 连接到实际检查逻辑
 * @param enforcementId - enforcement ID（对应约束定义中的 enforcement 字段）
 * @param executor - 执行器实现
 * @param source - 注册来源（如 'builtin', 'plugin'）
 */
export function registerExecutor(
  enforcementId: EnforcementId,
  executor: EnforcementExecutor,
  source?: string
): void {
  constraintInterceptor.register(enforcementId, executor, source);
}

/**
 * 检查约束（check 层）
 *
 * @param context - 约束上下文
 * @param options.onTrace - 每条约束检查后的回调（用于记录 trace 到外部存储）
 */
export async function checkConstraints(
  context: ConstraintContext,
  options?: { onTrace?: (result: import('./types/constraint').ConstraintResult) => void }
): Promise<ConstraintCheckResult> {
  const result = await constraintChecker.checkConstraints(context);
  if (options?.onTrace) {
    for (const r of result.ironLaws) options.onTrace(r);
    for (const r of result.guidelines) options.onTrace(r);
  }
  return result;
}

/**
 * 执行前检查（仅 Iron Laws）
 */
export async function checkBeforeExecution(
  context: ConstraintContext
): Promise<void> {
  return constraintChecker.beforeExecution(context);
}