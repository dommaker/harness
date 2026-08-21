/**
 * 约束检查器注册表（工单 21）
 *
 * checker.ts 编排层通过 getConstraintCheck(id) 查找实现。
 *
 * 注册表闭环（ADR-0001）：模块加载时校验全部 kind='check' 的内置约束
 * 都有已注册 checker，且注册表中没有无对应 check 定义的孤儿实现；
 * 任一不满足即抛错（加载期失败，不许静默 pass）。
 */

import type { ConstraintCheck } from './types';
import { getAllConstraints } from '../definitions';

import {
  noCompletionWithoutVerification,
  incrementalProgress,
  noImplementationWithoutRequirement,
} from './iron-flags';
import { noBypassCheckpoint } from './no-bypass-checkpoint';
import { noTestSimplification } from './no-test-simplification';
import { capabilitySync } from './capability-sync';
import { contextDocSync } from './context-doc-sync';
import { docsFreshness } from './docs-freshness';
import { noHardcodedCredentials } from './no-hardcoded-credentials';
import { governancePresence } from './governance-presence';

const CHECKS: ConstraintCheck[] = [
  // Iron Laws
  noCompletionWithoutVerification,
  incrementalProgress,
  noImplementationWithoutRequirement,
  noTestSimplification,
  docsFreshness,
  // Guidelines
  noHardcodedCredentials,
  noBypassCheckpoint,
  capabilitySync,
  contextDocSync,
  governancePresence,
];

const registry = new Map<string, ConstraintCheck>(CHECKS.map(c => [c.id, c]));

// ========================================
// 注册表闭环校验（加载期）
// ========================================

const checkConstraints = getAllConstraints().filter(c => c.kind === 'check');

for (const c of checkConstraints) {
  if (!registry.has(c.id)) {
    throw new Error(
      `[harness] 约束注册表闭环校验失败：kind='check' 的约束 "${c.id}" 未注册 checker。` +
      `请在 checkers/ 中实现并注册，或将该约束降级为 kind='prompt'。`
    );
  }
}

for (const id of registry.keys()) {
  if (!checkConstraints.some(c => c.id === id)) {
    throw new Error(
      `[harness] 约束注册表闭环校验失败：checker "${id}" 没有对应的 kind='check' 约束定义。` +
      `请在 definitions/ 中补齐定义，或从注册表移除。`
    );
  }
}

/**
 * 按约束 ID 查找检查实现；未注册返回 undefined
 * （编排层对 kind='check' 未注册的情况抛错，kind='prompt' 不查表）
 */
export function getConstraintCheck(id: string): ConstraintCheck | undefined {
  return registry.get(id);
}

/**
 * 已注册的检查实现数量（诊断/测试用）
 */
export function registeredCheckCount(): number {
  return registry.size;
}

export { buildCheckEnv } from './types';
export type { ConstraintCheck, CheckEnv, CheckOutcome, EvidenceProviders } from './types';
