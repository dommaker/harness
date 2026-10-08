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
  constraintChecker,
  ConstraintViolationError,
  buildCheckEnv,
  normalizeCheckOutcome,
  formatEvidence,
} from './constraints';
export type {
  CheckConstraintsOptions,
  ConstraintId,
  ConstraintChannel,
  ConstraintSeverity,
  ConstraintTrigger,
  Constraint,
  ConstraintResult,
  ConstraintContext,
  ConstraintCheckResult,
  ConstraintCheck,
  CheckEnv,
  CheckOutcome,
  CheckDetail,
  CheckSkip,
  NormalizedOutcome,
  EvidenceProviders,
  CheckInputNeeds,
  CheckEvidenceInput,
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

// 项目配置加载器 + governance 访问器族（governance 段读取一律经访问器，禁止消费方手写钻取；
// 访问器族住 constraints/governance-accessors，见该文件头注释）
export { ProjectConfigLoader, loadRawProjectConfig } from './project-config-loader';
export {
  getGovernanceConfig,
  resolveContextFiles,
  getCapabilitiesMode,
} from './constraints/governance-accessors';
export type { CapabilitiesMode, ContextFilesResolution } from './constraints/governance-accessors';
// 运行级观察面（ADR-0023 决策 1/2）：上面两组访问器与 ProjectConfigLoader 的入参形状
export type { RunEnv, RunTarget } from './constraints/run-env';

// 生效约束集（ADR-0001：唯一生效集来源）
export {
  getEffectiveConstraints,
} from './effective-constraints';
