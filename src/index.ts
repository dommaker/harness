/**
 * @dommaker/harness - 主入口
 * 
 * 通用工程约束框架
 * 
 * 三层约束体系：
 * - Iron Laws：绝对禁止，无例外
 * - Guidelines：优先建议，有例外
 * - Tips：信息性提示，可忽略
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
// 架构约束导出
// ========================================
export * from './architecture/constraint-engine';
export * from './architecture/cross-project-checker';

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
// 约束分层导出
// ========================================
export * from './constraints';

// ========================================
// Dashboard 数据导出
// ========================================
export * from './dashboard';

// ========================================
// LLM 适配器导出
// ========================================
export * from './llm';

// ========================================
// 工具注册表导出
// ========================================
export * from './tools';

// ========================================
// Agent 生命周期导出
// ========================================
export * from './agents';

// ========================================
// 预设导出
// ========================================
export * from './presets';

// ========================================
// 便捷 API
// ========================================

import { constraintChecker } from './core/constraints/checker';
import type { ConstraintContext, ConstraintCheckResult, ConstraintResult, ConstraintTrigger } from './types/constraint';
// 向后兼容
import type { IronLawContext, IronLawResult } from './types/constraint';
import { constraintInterceptor } from './core/constraints/interceptor';
import type { EnforcementExecutor, EnforcementContext, EnforcementResult, EnforcementId, InterceptionResult } from './types/enforcement';

export const interceptor = constraintInterceptor;

export async function interceptOperation(
  trigger: ConstraintTrigger,
  context: ConstraintContext
): Promise<InterceptionResult> {
  return constraintInterceptor.intercept(trigger, context);
}

export async function claimOperation(
  trigger: ConstraintTrigger,
  context: ConstraintContext
): Promise<void> {
  return constraintInterceptor.claim(trigger, context);
}

export function registerExecutor(
  enforcementId: EnforcementId,
  executor: EnforcementExecutor,
  source?: string
): void {
  constraintInterceptor.register(enforcementId, executor, source);
}

/**
 * 检查约束（三层）
 */
export async function checkConstraints(
  context: ConstraintContext
): Promise<ConstraintCheckResult> {
  return constraintChecker.checkConstraints(context);
}

/**
 * 执行前检查（仅 Iron Laws）
 */
export async function checkBeforeExecution(
  context: ConstraintContext
): Promise<void> {
  return constraintChecker.beforeExecution(context);
}

// ========================================
// 向后兼容 API
// ========================================

/**
 * @deprecated 使用 checkConstraints 代替
 */
export async function checkIronLaws(
  context: IronLawContext
): Promise<IronLawResult[]> {
  const result = await constraintChecker.checkConstraints(context);
  return [...result.ironLaws, ...result.guidelines, ...result.tips] as IronLawResult[];
}