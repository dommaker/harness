/**
 * 约束检查器注册表（工单 21；ADR-0033 拆两层）
 *
 * checker.ts 编排层通过 getConstraintCheck() 查找实现。
 *
 * 两层注册表：
 * - 内置 checker（registry，按约束 id）：模块加载时校验全部 channel='gate' 的内置约束
 *   都有已注册 checker（ADR-0035 闭环收窄：非 gate 条目不要求 checker），且注册表中
 *   没有无对应 gate 定义的孤儿实现；任一不满足即抛错（加载期失败，不许静默 pass，ADR-0001）。
 * - 模板 checker（TEMPLATES，按模板 id）：填空式参数化模板，供应用层约束
 *   （source='app'，`.harness/constraints.yml`）按 checker + params 实例化。
 *   闭环语义扩展而非开口：应用层约束在加载期（app-constraints-loader）校验
 *   模板 id 存在 + validateParams 通过；getConstraintCheck 对未注册模板 id 抛错。
 */

import type { Constraint } from '../../../types/constraint';
import type { ConstraintCheck } from './types';
import { getAllConstraints, isGateConstraint } from '../definitions';

import {
  noCompletionWithoutVerification,
} from './iron-flags';
import { noTestSimplification } from './no-test-simplification';
import { capabilitySync } from './capability-sync';
import { contextDocSync } from './context-doc-sync';
import { docsFreshness } from './docs-freshness';
import { noHardcodedCredentials } from './no-hardcoded-credentials';
import { governancePresence } from './governance-presence';
import { TEMPLATES } from './templates-registry';

const CHECKS: ConstraintCheck[] = [
  // severity='error'
  noCompletionWithoutVerification,
  noTestSimplification,
  docsFreshness,
  noHardcodedCredentials,
  // severity='warning'
  capabilitySync,
  contextDocSync,
  governancePresence,
];

const registry = new Map<string, ConstraintCheck>(CHECKS.map(c => [c.id, c]));

// ========================================
// 模板注册表（ADR-0033，应用层约束用）
// ========================================

// TEMPLATES 住在 ./templates-registry（独立模块防值级循环，见该文件头注释）；
// 此处 re-export 供编排层与测试单口取数
export { TEMPLATES } from './templates-registry';

// ========================================
// 注册表闭环校验（加载期）
// ========================================

const checkConstraints = getAllConstraints().filter(c => c.kind === 'check' && isGateConstraint(c));

for (const c of checkConstraints) {
  if (!registry.has(c.id)) {
    throw new Error(
      `[harness] 约束注册表闭环校验失败：channel='gate' 的约束 "${c.id}" 未注册 checker。` +
      `请在 checkers/ 中实现并注册；无 checker 的纪律/流程规则须标非 gate 通道（ADR-0035）。`
    );
  }
}

for (const id of registry.keys()) {
  if (!checkConstraints.some(c => c.id === id)) {
    throw new Error(
      `[harness] 约束注册表闭环校验失败：checker "${id}" 没有对应的 channel='gate' 约束定义。` +
      `请在 definitions/ 中补齐定义，或从注册表移除。`
    );
  }
}

/**
 * 查找检查实现
 *
 * - 传字符串 id 或内置约束：按 id 查内置注册表，未注册返回 undefined
 *   （编排层对 channel='gate' 未注册的情况抛错）
 * - 传 source='app' 的约束：按 checker 模板 id + params 实例化；
 *   模板 id 未注册 → 抛错（闭环保留，不许静默 pass）
 */
export function getConstraintCheck(idOrConstraint: string | Constraint): ConstraintCheck | undefined {
  if (typeof idOrConstraint === 'string') {
    return registry.get(idOrConstraint);
  }
  if (idOrConstraint.source === 'app') {
    const templateId = idOrConstraint.checker;
    const factory = templateId ? TEMPLATES.get(templateId) : undefined;
    if (!factory) {
      throw new Error(
        `[harness] 约束注册表闭环校验失败：应用层约束 "${idOrConstraint.id}" 引用的 checker 模板 ` +
        `"${templateId ?? '（未填写）'}" 未注册。请在 checkers/templated/ 中实现并注册。`
      );
    }
    return factory.create(idOrConstraint.id, idOrConstraint.params ?? {});
  }
  return registry.get(idOrConstraint.id);
}

/**
 * 已注册的检查实现数量（诊断/测试用）
 */
export function registeredCheckCount(): number {
  return registry.size;
}

export { buildCheckEnv, normalizeCheckOutcome, findMissingInputs, degradeForMissingInputs } from './types';
export type {
  ConstraintCheck,
  TemplatedCheckerFactory,
  CheckEnv,
  CheckOutcome,
  CheckDetail,
  CheckSkip,
  CheckInputNeeds,
  CheckEvidenceInput,
  ContextEvidenceFlag,
  NormalizedOutcome,
  EvidenceProviders,
} from './types';
