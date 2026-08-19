/**
 * 核心模块导出（ADR-0003：显式清单，禁 export *）
 *
 * checkConstraints 与包根统一为 options 对象签名（CheckConstraintsOptions），
 * 不再暴露位置参数版。
 */

// 约束系统（三层：Iron Laws / Guidelines / Tips）
export {
  IRON_LAWS,
  GUIDELINES,
  PROMPTS,
  getAllConstraints,
  findConstraintsByTrigger,
  getConstraint,
  ConstraintChecker,
  checkConstraint,
  checkConstraints,
  checkBeforeExecution,
  constraintChecker,
  CONSTRAINTS_START_MARKER,
  CONSTRAINTS_END_MARKER,
  renderConstraintsSection,
  CheckCache,
  renderConstraintsByTrigger,
  ConstraintViolationError,
  ConstraintInterceptor,
  constraintInterceptor,
  interceptOperation,
  claimOperation,
} from './constraints';
export type {
  CheckConstraintsOptions,
  CheckCacheConfig,
  CheckSamplingConfig,
  RenderConstraintsByTriggerOptions,
  ConstraintId,
  ConstraintKind,
  ConstraintLevel,
  ConstraintTrigger,
  Constraint,
  ConstraintResult,
  ConstraintContext,
  ConstraintCheckResult,
  IronLawContext,
  EnforcementId,
  EnforcementExecutor,
  EnforcementContext,
  EnforcementResult,
  InterceptionResult,
} from './constraints';

// 验证器（检查点 / PassesGate / CSO）
export {
  CheckpointValidator,
  PassesGate,
  createPassesGate,
  CSOValidator,
} from './validators';
export type {
  CSOValidationResult,
  CSOIssue,
  Checkpoint,
  CheckpointCheck,
  CheckpointResult,
  CheckResult,
  CheckpointContext,
  CheckType,
  CheckConfig,
  PassesGateConfig,
  PassesGateResult,
  TaskTestResult,
  DynamicTask,
} from './validators';

// 会话启动 / 净室状态
export {
  SessionStartup,
  createSessionStartup,
  DEFAULT_CODE_CHECKPOINTS,
  MINIMAL_CHECKPOINTS,
  CleanStateManager,
  createCleanStateManager,
} from './session';

// Spec 验证器
export { SpecValidator } from './spec/validator';
export type {
  SpecValidatorConfig,
  SpecValidationResult,
  BatchSpecValidationResult,
  SpecSchemaDefinition,
  SpecType,
} from '../types/spec';

// 项目配置加载器
export {
  ProjectConfigLoader,
  loadRawProjectConfig,
  getCapabilitiesMode,
} from './project-config-loader';
export type { CapabilitiesMode } from './project-config-loader';

// 生效约束集（ADR-0001：唯一生效集来源）
export {
  getEffectiveConstraints,
  lintEffectiveConfig,
} from './effective-constraints';
export type { EffectiveConfigLint } from './effective-constraints';
