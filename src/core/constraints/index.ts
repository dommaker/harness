/**
 * 约束模块入口
 */

// 约束定义（kind 二元：check 层 + prompt 层；TIPS 已退役，空表仅为在途兼容保留）
export {
  IRON_LAWS,
  GUIDELINES,
  PROMPTS,
  TIPS,
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

// CLAUDE.md 约束注入段渲染（纯函数，init 注入与漂移校验共用）
export {
  CONSTRAINTS_START_MARKER,
  CONSTRAINTS_END_MARKER,
  renderConstraintsSection,
} from './injection-renderer';

// 类型导出
export type {
  ConstraintId,
  ConstraintKind,
  ConstraintLevel,
  ConstraintTrigger,
  Constraint,
  ConstraintResult,
  ConstraintContext,
  ConstraintCheckResult,
  IronLawContext,
} from '../../types/constraint';

export { ConstraintViolationError } from '../../types/constraint';

// 约束拦截器
export {
  ConstraintInterceptor,
  constraintInterceptor,
  interceptOperation,
  claimOperation,
} from './interceptor';

export type {
  EnforcementId,
  EnforcementExecutor,
  EnforcementContext,
  EnforcementResult,
  InterceptionResult,
} from '../../types/enforcement';