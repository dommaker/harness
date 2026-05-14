/**
 * ConstraintViolationHandler — 约束违规统一处理（S4）
 *
 * 问题：ConstraintViolationError 在 4 个调用点有 4 种行为：
 *   1. 抛异常阻断（checker.ts / interceptor.ts）
 *   2. 返回 null（report.ts catch 后返回空数据）
 *   3. 返回 403 HTTP 状态
 *   4. console.warn 静默吞掉
 *
 * 解决：提供 3 种标准化处理策略，消除 ad-hoc catch 行为。
 */

import type { ConstraintCheckResult } from '../types/constraint';

/**
 * 违规处理策略
 */
export type ViolationStrategy = 'BLOCK' | 'COLLECT' | 'SAFE_BOOLEAN';

/**
 * 违规处理结果
 */
export interface ViolationHandlingResult {
  /** 策略 */
  strategy: ViolationStrategy;
  /** 检查结果（COLLECT 策略时总是有值） */
  checkResult?: ConstraintCheckResult;
  /** 是否有违规（SAFE_BOOLEAN 策略时为 false） */
  hasViolation: boolean;
  /** 违规数量 */
  violationCount: number;
}

/**
 * 约束违规处理器
 *
 * 用法：
 * ```typescript
 * const handler = new ConstraintViolationHandler();
 *
 * // 策略 1: BLOCK — 抛异常阻断（Iron Laws 默认）
 * await handler.execute(checkFn, 'BLOCK');
 *
 * // 策略 2: COLLECT — 收集违规不抛异常（用于报告生成）
 * const result = await handler.execute(checkFn, 'COLLECT');
 * // result.checkResult 总是有值
 *
 * // 策略 3: SAFE_BOOLEAN — 返回真/假（用于 canProceed 类方法）
 * const ok = await handler.execute(checkFn, 'SAFE_BOOLEAN');
 * // ok.hasViolation 为 true/false
 * ```
 */
export class ConstraintViolationHandler {
  /**
   * 执行约束检查并统一处理结果
   *
   * @param checkFn 约束检查函数（可能抛出 ConstraintViolationError）
   * @param strategy 处理策略
   * @returns 标准化结果
   */
  async execute(
    checkFn: () => Promise<ConstraintCheckResult>,
    strategy: ViolationStrategy
  ): Promise<ViolationHandlingResult> {
    switch (strategy) {
      case 'BLOCK':
        return this.handleBlock(checkFn);
      case 'COLLECT':
        return this.handleCollect(checkFn);
      case 'SAFE_BOOLEAN':
        return this.handleSafeBoolean(checkFn);
    }
  }

  /**
   * BLOCK 策略：违规即抛出，无违规返回结果
   */
  private async handleBlock(
    checkFn: () => Promise<ConstraintCheckResult>
  ): Promise<ViolationHandlingResult> {
    const result = await checkFn();
    return {
      strategy: 'BLOCK',
      checkResult: result,
      hasViolation: !result.passed,
      violationCount: result.ironLaws.filter(r => !r.satisfied).length,
    };
  }

  /**
   * COLLECT 策略：捕获异常，收集所有违规，不抛出
   */
  private async handleCollect(
    checkFn: () => Promise<ConstraintCheckResult>
  ): Promise<ViolationHandlingResult> {
    try {
      const result = await checkFn();
      const ironViolations = result.ironLaws.filter(r => !r.satisfied).length;
      const guideViolations = result.warningCount;
      return {
        strategy: 'COLLECT',
        checkResult: result,
        hasViolation: !result.passed || guideViolations > 0,
        violationCount: ironViolations + guideViolations,
      };
    } catch {
      // 捕获 ConstraintViolationError，返回失败结果
      const empty: ConstraintCheckResult = {
        ironLaws: [],
        guidelines: [],
        tips: [],
        passed: false,
        warningCount: 0,
        tipCount: 0,
      };
      return {
        strategy: 'COLLECT',
        checkResult: empty,
        hasViolation: true,
        violationCount: 1,
      };
    }
  }

  /**
   * SAFE_BOOLEAN 策略：不抛异常，只返回 boolean
   */
  private async handleSafeBoolean(
    checkFn: () => Promise<ConstraintCheckResult>
  ): Promise<ViolationHandlingResult> {
    try {
      const result = await checkFn();
      return {
        strategy: 'SAFE_BOOLEAN',
        hasViolation: !result.passed,
        violationCount: result.ironLaws.filter(r => !r.satisfied).length,
      };
    } catch {
      return {
        strategy: 'SAFE_BOOLEAN',
        hasViolation: true,
        violationCount: 1,
      };
    }
  }
}

/**
 * 快捷：BLOCK 策略执行检查
 */
export async function executeWithBlock(
  checkFn: () => Promise<ConstraintCheckResult>
): Promise<ViolationHandlingResult> {
  return new ConstraintViolationHandler().execute(checkFn, 'BLOCK');
}

/**
 * 快捷：COLLECT 策略执行检查
 */
export async function executeWithCollect(
  checkFn: () => Promise<ConstraintCheckResult>
): Promise<ViolationHandlingResult> {
  return new ConstraintViolationHandler().execute(checkFn, 'COLLECT');
}

/**
 * 快捷：SAFE_BOOLEAN 策略执行检查
 */
export async function executeWithSafeBoolean(
  checkFn: () => Promise<ConstraintCheckResult>
): Promise<ViolationHandlingResult> {
  return new ConstraintViolationHandler().execute(checkFn, 'SAFE_BOOLEAN');
}
