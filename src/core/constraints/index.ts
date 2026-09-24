/**
 * 约束模块入口
 */

// 约束定义（check 全量，severity 在条目上）
export {
  CONSTRAINTS,
  getAllConstraints,
  findConstraintsByTrigger,
  getConstraint,
} from './definitions';

// 约束检查器
export {
  ConstraintChecker,
  checkConstraint,
  checkConstraints,
  checkBeforeExecution,
  constraintChecker,
} from './checker';
export type { CheckConstraintsOptions, TraceRecorder } from './checker';

// 约束检查缓存（H6/G5：TTL 缓存 + 计数采样，公开导出）
export { CheckCache } from './check-cache';
export type { CheckCacheConfig, CheckSamplingConfig } from './check-cache';

// 检查器原语 SDK（harness#181，ADR-0035 决策 3 第二半：只导出存量——现有 checker 真实在用的件）
export {
  buildCheckEnv,
  normalizeCheckOutcome,
  formatEvidence,
  contextFlag,
  contextEvidenceFlag,
} from './checkers';
export type {
  ConstraintCheck,
  CheckEnv,
  CheckOutcome,
  CheckDetail,
  CheckSkip,
  NormalizedOutcome,
  EvidenceProviders,
  CheckInputNeeds,
  CheckEvidenceInput,
  ContextEvidenceFlag,
} from './checkers';

// 类型导出
export type {
  ConstraintId,
  ConstraintKind,
  ConstraintChannel,
  ConstraintSeverity,
  ConstraintTrigger,
  Constraint,
  ConstraintResult,
  ConstraintContext,
  ConstraintCheckResult,
  IronLawContext,
} from '../../types/constraint';

export { ConstraintViolationError } from '../../types/constraint';
