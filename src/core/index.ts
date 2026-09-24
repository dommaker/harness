/**
 * 核心模块导出（ADR-0003：显式清单，禁 export *）
 *
 * checkConstraints 与包根统一为 options 对象签名（CheckConstraintsOptions），
 * 不再暴露位置参数版。
 */

// 约束系统（severity 显式模型，ADR-0029）
export {
  CONSTRAINTS,
  getAllConstraints,
  findConstraintsByTrigger,
  getConstraint,
  ConstraintChecker,
  checkConstraint,
  checkConstraints,
  checkBeforeExecution,
  constraintChecker,
  CheckCache,
  ConstraintViolationError,
  buildCheckEnv,
  normalizeCheckOutcome,
  formatEvidence,
  contextFlag,
  contextEvidenceFlag,
} from './constraints';
export type {
  CheckConstraintsOptions,
  CheckCacheConfig,
  CheckSamplingConfig,
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
  TaskTestResult,
} from './validators';

// Spec 验证器
export { SpecValidator } from './spec/validator';
export type {
  SpecValidatorConfig,
  SpecValidationResult,
  BatchSpecValidationResult,
  SpecSchemaDefinition,
  SpecType,
} from '../types/spec';

// 项目配置加载器（governance 段读取一律经访问器，禁止消费方手写钻取）
export {
  ProjectConfigLoader,
  loadRawProjectConfig,
  getGovernanceConfig,
  resolveContextFiles,
  getCapabilitiesMode,
} from './project-config-loader';
export type { CapabilitiesMode, ContextFilesResolution } from './project-config-loader';
// 运行级观察面（ADR-0023 决策 1/2）：上面两组访问器与 ProjectConfigLoader 的入参形状
export type { RunEnv, RunTarget } from './constraints/run-env';

// 生效约束集（ADR-0001：唯一生效集来源）
export {
  getEffectiveConstraints,
  lintEffectiveConfig,
} from './effective-constraints';
export type { EffectiveConfigLint } from './effective-constraints';
