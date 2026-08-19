/**
 * @dommaker/harness - 主入口
 *
 * 通用工程约束框架
 *
 * 约束体系（ADR-0001 kind 二元）：
 * - check：可执行检查（Iron Laws 阻断 / Guidelines 告警）
 * - prompt：纯文本注入，不参与检查
 *
 * 门禁系统：
 * - PassesGate：测试门控
 * - ReviewGate：审查门禁
 * - SecurityGate：安全门禁
 * - PerformanceGate：性能门禁
 * - ContractGate：契约门禁
 * - CheckpointValidator：检查点验证
 *
 * 公共导出（ADR-0003）：显式清单，禁 export *。
 * 收录标准：属 harness 定位（约束数据 / 执行引擎 / 注入工具 / 知识基建）、
 * 实现真实可用、无同名冲突。内部 seam
 * （ConstraintChecker / constraintChecker / ProjectConfigLoader）不进公共清单。
 */

// ========================================
// 约束类型（三层体系 + kind 二元）
// ========================================
export {
  ConstraintViolationError,
} from './types/constraint';
export type {
  Constraint,
  ConstraintId,
  ConstraintKind,
  ConstraintLevel,
  ConstraintTrigger,
  ConstraintContext,
  ConstraintResult,
  ConstraintCheckResult,
  IronLawContext,
} from './types/constraint';

// ========================================
// 约束数据（内置定义 + 生效集）
// ========================================
export {
  IRON_LAWS,
  GUIDELINES,
  PROMPTS,
  getAllConstraints,
  getConstraint,
  findConstraintsByTrigger,
} from './core/constraints/definitions';
export {
  getEffectiveConstraints,
  lintEffectiveConfig,
} from './core/effective-constraints';
export type { EffectiveConfigLint } from './core/effective-constraints';

// ========================================
// 约束检查引擎（便捷 API；options 统一签名，ADR-0003）
// ========================================
export {
  checkConstraint,
  checkConstraints,
  checkBeforeExecution,
} from './core/constraints/checker';
export type { CheckConstraintsOptions } from './core/constraints/checker';

// ========================================
// 约束缓存与注入渲染
// ========================================
export { CheckCache } from './core/constraints/check-cache';
export type { CheckCacheConfig, CheckSamplingConfig } from './core/constraints/check-cache';
export { renderConstraintsByTrigger } from './core/constraints/agent-prompt-renderer';
export type { RenderConstraintsByTriggerOptions } from './core/constraints/agent-prompt-renderer';
export {
  CONSTRAINTS_START_MARKER,
  CONSTRAINTS_END_MARKER,
  renderConstraintsSection,
} from './core/constraints/injection-renderer';

// ========================================
// 检查点与验证器
// ========================================
export type {
  Checkpoint,
  CheckpointCheck,
  CheckpointContext,
  CheckpointResult,
  CheckConfig,
  CheckResult,
  CheckType,
} from './types/checkpoint';
export {
  CheckpointValidator,
  PassesGate,
  createPassesGate,
  CSOValidator,
} from './core/validators';
export type { CSOIssue, CSOValidationResult } from './core/validators';
export type {
  PassesGateConfig,
  PassesGateResult,
  PassesGateCheckResult,
  PassesGateViolation,
  PassesGateExtension,
  TestResult,
  DynamicTask,
  TaskTestResult,
  ExtensionTestResult,
} from './types/passes-gate';
export type {
  StepMeta,
  ToolMeta,
  WorkflowMeta,
} from './types/cso';

// ========================================
// 会话启动 / 净室状态
// ========================================
export {
  SessionStartup,
  createSessionStartup,
  DEFAULT_CODE_CHECKPOINTS,
  MINIMAL_CHECKPOINTS,
  CleanStateManager,
  createCleanStateManager,
} from './core/session';
export type {
  StartupCheckpoints,
  StartupCheckpointType,
  StartupCheckpointResult,
  CleanStateConfig,
  CleanStateResult,
  DetectedBug,
  TaskListJson,
  TaskStepStatus,
  SessionInfo,
} from './types/session';
// 与 passes-gate 同名类型的 session 版（沿用既有别名）
export { DynamicTask as ExtendedDynamicTask, TaskTestResult as ExtendedTaskTestResult } from './types/session';

// ========================================
// Spec 验证（已接线的 spec 故事：validator + SpecAcceptanceGate）
// ========================================
export { SpecValidator, validateSpec, validateAllSpecs } from './core/spec/validator';
export type {
  SpecValidatorConfig,
  SpecValidationResult,
  BatchSpecValidationResult,
  SpecSchemaDefinition,
  SpecType,
  SpecValidationError,
  SchemaLoader,
} from './types/spec';

// ========================================
// 门禁系统（公共面 = ./gates 子路径出口）
// ========================================
export {
  ReviewGate,
  SecurityGate,
  PerformanceGate,
  ContractGate,
  SpecAcceptanceGate,
  CommandGate,
  createCommandGate,
  getCommandGate,
  isCommandAllowed,
  getCommandRiskLevel,
  DEFAULT_COMMAND_BLACKLIST,
  createReviewGate,
  createSecurityGate,
  createPerformanceGate,
  createContractGate,
  createSpecAcceptanceGate,
  decisionFromResult,
  GATE_DEFINITIONS,
  getGate,
  listRegisteredGates,
  registeredGateCount,
  assertGateRegistryClosed,
  runGates,
  getEffectiveGates,
  createCheckerGate,
} from './gates';
export type {
  GateResult,
  GateContext,
  Gate,
  GateDecision,
  GateDecisionStatus,
  GateDefinition,
  GateRunResult,
  GatesConfig,
  PerformanceThresholds,
  ReviewGateConfig,
  SecurityGateConfig,
  PerformanceGateConfig,
  ContractGateConfig,
  SpecAcceptanceGateConfig,
  AcceptanceGateContext,
  AcceptanceCriteria,
  CommandBlacklistRule,
  CommandGateConfig,
} from './gates';

// ========================================
// 监控（Execution Trace 收集/分析 + 上下文追踪）
// ========================================
export {
  DEFAULT_TRACE_FILE,
} from './types/trace';
export type {
  ExecutionTrace,
  TraceFilter,
  TraceSummary,
  TraceAnomaly,
  TraceCollectorConfig,
  TraceAnalyzerConfig,
} from './types/trace';
export {
  TraceCollector,
  getTraceCollector,
  configureTraceCollector,
  TraceAnalyzer,
  createAnalyzer,
  ContextTracker,
} from './monitoring';
export type { ContextAverages } from './monitoring';

// ========================================
// 失败处理（错误分类 + 记录 + 违规处理策略）
// ========================================
export {
  ErrorType,
  FailureLevel,
  DEFAULT_CLASSIFICATION_RULES,
  DEFAULT_LEVEL_MAPPING,
  ErrorClassifier,
  createErrorClassifier,
  classifyError,
  getFailureLevel,
  FailureRecorder,
  createFailureRecorder,
  ConstraintViolationHandler,
  executeWithBlock,
  executeWithCollect,
  executeWithSafeBoolean,
} from './failure';
export type {
  FailureRecord,
  ErrorClassificationRule,
  ClassificationResult,
  ErrorClassifierConfig,
  FailureRecorderConfig,
  ViolationStrategy,
  ViolationHandlingResult,
} from './failure';

// ========================================
// 上下文管理（Token 预算 + 会话压缩 + 知识注入）
// ========================================
export {
  AdaptiveTokenBudget,
  TokenBudget,
  TokenEstimator,
  DEFAULT_COMPACTION_CONFIG,
  SessionCompaction,
  SessionManager,
  KnowledgeInjector,
} from './context';
export type {
  CompactionConfig,
  CompactionLevel,
  CompactionResult,
  ContextSource,
  ContextSourceType,
  ContextUsageSnapshot,
  InjectionConfig,
  InjectionResult,
  SessionCheckpoint,
  SessionEvent,
  SessionEventType,
  SessionHandle,
  SessionMessage,
} from './context';

// ========================================
// 知识引擎（Knowledge 基建）
// ========================================
export {
  FileKnowledgeStore,
  KnowledgeQuery,
  KnowledgeLifecycle,
  KnowledgeIngest,
  sanitizeExternalContent,
  ReferenceTracker,
  KnowledgeLinter,
  ColdStartImporter,
  KnowledgeHealthScorer,
  KnowledgeLifecycleHooks,
  KnowledgeAudit,
  migrateKnowledgeEntries,
  extractCodeStructure,
  DEFAULT_DECAY_CONFIG,
} from './knowledge';
export type {
  KnowledgeEntry,
  KnowledgeStore,
  KnowledgeSubsystem,
  KnowledgeOrigin,
  KnowledgeReference,
  MaturityLevel,
  MaturityChange,
  DecayConfig,
  SourceRef,
  DecisionRecord,
  QueryFilter,
  QueryBudget,
  QueryResult,
  ExecutionResult,
  IndexEntry,
  StorageLayer,
  ConsumptionEvent,
  ConsumptionMode,
  IngestOptions,
  ReferenceRecord,
  LintIssue,
  LintIssueType,
  AuditRuleName,
  AuditAction,
  AuditIssue,
  AuditReport,
  AuditOptions,
  CodeStructure,
  DeclarationInfo,
  ImportInfo,
} from './knowledge';

// ========================================
// Completion Checkers（T7-E1，studio#160）
// WU 收尾软观测三纯判定函数：tdd-chain / phase-format / contract-presence。
// 纯函数直接 export，不进 ConstraintCheck 闭环注册表。
// ========================================
export {
  DEFAULT_TEST_GLOBS,
  DEFAULT_NONCODE_GLOBS,
  matchGlob,
  matchAnyGlob,
  classifyCommitFiles,
  resolveGlobs,
  verifyTddChain,
  TESTED_BY_RE,
  TESTS_NONE_RE,
  verifyPhaseFormat,
  PHASE_SUBJECT_RE,
  verifyContractPresence,
} from './completion-checkers';
export type {
  CheckerVerdict,
  CommitVerdict,
  CommitInput,
  CommitFileClassification,
  CompletionCheckersConfig,
  ContractPresenceContext,
  ContractPresenceResult,
  PhaseFormatResult,
  TddChainResult,
} from './completion-checkers';

// ========================================
// 工具路径
// ========================================
export { getRegistryPath, getToolsDir } from './tools';

// ========================================
// Hooks 管线
// ========================================
export {
  HookRegistry,
  assertHookRegistryClosed,
  HookPipeline,
  toErrorStrategy,
  bootstrapHarness,
  bootstrapHarnessSync,
} from './hooks';
export type {
  HookDefinition,
  HookConfig,
  HookErrorStrategy,
  HookExecutionRecord,
  HookPhase,
  HookResult,
  PipelineResult,
  HarnessBootstrap,
} from './hooks';

// ========================================
// Agent 生命周期
// ========================================
export {
  AgentLifecycle,
} from './agents';
export type {
  AgentConfig,
  AgentEvent,
  AgentState,
  AgentStatus,
  EventHandler,
  FallbackStrategy,
} from './agents';

// ========================================
// 项目配置类型（config.yml 形状；Loader 属内部 seam 不公开）
// ========================================
export type {
  ProjectConfig,
  MergedConstraintsConfig,
  CustomConstraintDefinition,
  GovernanceConfig,
  CapabilitiesConfig,
  ChangelogConfig,
  ChangelogVersionCheck,
  TestingGovernanceConfig,
  ContextFilesConfig,
  ContextDocsCheck,
  DocsSyncConfig,
  DocFreshnessConfig,
  DocFreshnessCheck,
  DocDirCheck,
  DocRegexCountCheck,
  ConstCountActual,
  DirCountActual,
  GrepCountActual,
} from './types/project-config';
