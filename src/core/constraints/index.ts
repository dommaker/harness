/**
 * 约束模块入口
 */

// 约束定义（kind 二元：check 层 + prompt 层）
export {
  IRON_LAWS,
  GUIDELINES,
  PROMPTS,
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

// CLAUDE.md 约束注入段渲染（纯函数，init 注入与漂移校验共用）
export {
  CONSTRAINTS_START_MARKER,
  CONSTRAINTS_END_MARKER,
  renderConstraintsSection,
} from './injection-renderer';

// 约束检查缓存（H6/G5：TTL 缓存 + 计数采样，公开导出）
export { CheckCache } from './check-cache';
export type { CheckCacheConfig, CheckSamplingConfig } from './check-cache';

// Agent prompt 约束段渲染（H6/G6：trigger 参数化分组渲染，role 路由留 studio）
export {
  renderConstraintsByTrigger,
} from './agent-prompt-renderer';
export type { RenderConstraintsByTriggerOptions } from './agent-prompt-renderer';

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