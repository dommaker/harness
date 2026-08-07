/**
 * 约束检查器注册表（工单 21）
 *
 * checker.ts 编排层通过 getConstraintCheck(id) 查找实现，
 * 未注册的约束默认通过（保持历史 default 分支语义）。
 */

import type { ConstraintCheck } from './types';

import {
  noSelfApproval,
  noCompletionWithoutVerification,
  incrementalProgress,
  verifyExternalCapability,
  noImplementationWithoutRequirementReview,
  noImplementationWithoutRequirement,
  preferWorktree,
  noClaimWithoutEvidence,
  noDeleteWithoutContext,
  twoStageReviewRequired,
} from './iron-flags';
import {
  noFixWithoutRootCause,
  noCodeWithoutTest,
  simplestSolutionFirst,
  noCreationWithoutReuseCheck,
  noSkillWithoutTest,
} from './guideline-flags';
import {
  surgicalChangesOnly,
  noModelForDeterministic,
  noConflictBlending,
  readBeforeWrite,
  followConventions,
  firstPrinciplesFirst,
  fixTheProblemNotTheGate,
  diagnosisToFixGate,
  readmeRequired,
  docRequiredForPublicApi,
} from './always-pass';
import { noBypassCheckpoint } from './no-bypass-checkpoint';
import { noTestSimplification } from './no-test-simplification';
import { noFuzzyCompletionClaim } from './no-fuzzy-completion-claim';
import { noPerformativeAgreement } from './no-performative-agreement';
import { noExcusePatterns } from './no-excuse-patterns';
import { noAnyType } from './no-any-type';
import { capabilitySync } from './capability-sync';
import { noSimplificationWithoutApproval } from './no-simplification-without-approval';
import { testCoverageRequired } from './test-coverage';
import { contextDocSync } from './context-doc-sync';
import { docsFreshness } from './docs-freshness';
import { yagniCheck } from './yagni';

const CHECKS: ConstraintCheck[] = [
  // Iron Laws
  noBypassCheckpoint,
  noSelfApproval,
  noCompletionWithoutVerification,
  noTestSimplification,
  incrementalProgress,
  verifyExternalCapability,
  noImplementationWithoutRequirementReview,
  noImplementationWithoutRequirement,
  preferWorktree,
  noFuzzyCompletionClaim,
  noClaimWithoutEvidence,
  noDeleteWithoutContext,
  noPerformativeAgreement,
  twoStageReviewRequired,
  // Guidelines
  noFixWithoutRootCause,
  noCodeWithoutTest,
  noAnyType,
  simplestSolutionFirst,
  noCreationWithoutReuseCheck,
  capabilitySync,
  noSimplificationWithoutApproval,
  noSkillWithoutTest,
  testCoverageRequired,
  contextDocSync,
  docsFreshness,
  noExcusePatterns,
  yagniCheck,
  // 行为类（promptInjection 驱动）恒通过
  surgicalChangesOnly,
  noModelForDeterministic,
  noConflictBlending,
  readBeforeWrite,
  followConventions,
  firstPrinciplesFirst,
  fixTheProblemNotTheGate,
  diagnosisToFixGate,
  // Tips
  readmeRequired,
  docRequiredForPublicApi,
];

const registry = new Map<string, ConstraintCheck>(CHECKS.map(c => [c.id, c]));

/**
 * 按约束 ID 查找检查实现；未注册返回 undefined（编排层默认通过）
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

export type { ConstraintCheck, CheckEnv } from './types';
