/**
 * 门禁命令测试的决策替身
 *
 * 命令的唯一入口是 `evaluate()`，所以替身是「产一枚决策的假门禁」——
 * 映射与报告构造器用真实现（decisionFromResult / gateResult），
 * 六个命令的测试因此不需要 git、gh 或真扫描。
 */

import { decisionFromResult } from '../../../gates/decision';
import { gateResult } from '../../../gates/types';
import type { GateDecision } from '../../../gates/types';

export function decide(
  gateId: string,
  passed: boolean,
  message: string,
  details?: Record<string, any>
): GateDecision {
  return decisionFromResult(gateResult(gateId, passed, message, Date.now(), details));
}

/** 恒产同一枚决策的假门禁（evaluate 记录调用参数，供断言上下文） */
export function fakeGate(decision: GateDecision): { evaluate: jest.Mock } {
  return { evaluate: jest.fn().mockResolvedValue(decision) };
}

/** evaluate 直接抛出的假门禁：命令出错分支测的是门禁之外的失败（git / fs） */
export function throwingGate(error: unknown): { evaluate: jest.Mock } {
  return { evaluate: jest.fn().mockRejectedValue(error) };
}
