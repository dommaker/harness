/**
 * 约束模块入口
 */

// 三层约束定义
export {
  IRON_LAWS,
  GUIDELINES,
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

// 类型导出
export type {
  ConstraintId,
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