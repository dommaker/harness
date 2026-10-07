/**
 * @dommaker/harness - 主入口
 *
 * 通用工程约束框架
 *
 * 约束体系（ADR-0029 severity 显式模型）：
 * - 全部约束 kind='check'：可执行检查（error 阻断 / warning 告警）
 * - 纯文本提示层已整体关停（ADR-0029）
 *
 * 门禁系统：
 * - PassesGate：测试门控
 * - CheckpointValidator：检查点验证
 * （其余 Gate 类随 #199/ADR-0038 收回内部：CLI 可达 ≠ 导出理由，
 *  消费方经实现文件直引，见 src/gates/CONTEXT.md）
 *
 * 公共导出（ADR-0003）：显式清单，禁 export *。
 * 收录标准：属 harness 定位（约束数据 / 执行引擎 / 知识基建）、
 * 实现真实可用、无同名冲突。内部 seam
 * （ConstraintChecker / constraintChecker / ProjectConfigLoader）不进公共清单。
 */

// ========================================
// 约束类型（severity 显式模型）
// ========================================
export {
  ConstraintViolationError,
} from './types/constraint';
export type {
  Constraint,
  ConstraintId,
  ConstraintKind,
  ConstraintChannel,
  ConstraintSeverity,
  ConstraintTrigger,
  ConstraintContext,
  ConstraintResult,
  ConstraintCheckResult,
} from './types/constraint';

// ========================================
// 约束数据（内置定义 + 生效集）
// ========================================
export {
  CONSTRAINTS,
  getAllConstraints,
  getConstraint,
  findConstraintsByTrigger,
} from './core/constraints/definitions';
export {
  getEffectiveConstraints,
} from './core/effective-constraints';
export {
  listRetiredConstraints,
} from './core/retired-constraints';
export type {
  RetiredConstraintEntry,
  RetiredConstraintMeta,
} from './core/retired-constraints';

// ========================================
// 约束变更面（harness#198）：retire/reactivate/disable + 提案打包 + 元数据 + 配置铺放
// 下游消费方经库面完成约束变更，不再偷看 `.harness/` 内部、免起子进程。
// 知识沉淀写口是注入 seam（harness#88 分层纪律：core 不 value-import 知识层）——
// retire/reactivate 缺省只落 config.yml，要沉淀经 options.openKnowledgeStore 注入；
// CLI 命令是已接线的组合根。
// ========================================
export {
  retireConstraint,
  reactivateConstraint,
  disableConstraint,
} from './core/constraint-lifecycle';
export type {
  LifecycleKnowledgeSink,
  RetireExecuteOptions,
  RetireStatus,
  RetireResult,
  RetireTargetInfo,
  ReactivateExecuteOptions,
  ReactivateStatus,
  ReactivateResult,
  DisableStatus,
  DisableResult,
} from './core/constraint-lifecycle';
export {
  packProposal,
  collectProposalMaterial,
  renderProposalMarkdown,
  proposalMaterialPath,
} from './core/constraints/pack-proposal';
export type {
  ProposalMaterial,
  PackProposalResult,
} from './core/constraints/pack-proposal';
export {
  getConstraintsMeta,
} from './core/constraints/meta';
export type { ConstraintsMeta } from './core/constraints/meta';
export {
  HARNESS_CONFIG_FILES,
  propagateConfig,
} from './core/config-files';

// ========================================
// 约束使用报告（退役候选诊断数据层，下游消费方进化链路消费）
// ========================================
export {
  buildConstraintsUsageReport,
  diagnoseRetireCandidates,
  collectUsageByConstraint,
  readProjectTraces,
  readProjectTracesReport,
  CANDIDATE_KIND_LABEL,
  DEFAULT_DIAGNOSE_THRESHOLDS,
} from './core/constraints/usage-report';
export type {
  ConstraintUsageStats,
  RetireCandidate,
  RetireCandidateKind,
  DiagnoseThresholds,
  ConstraintsUsageReport,
} from './core/constraints/usage-report';

// ========================================
// 约束检查引擎（便捷 API；options 统一签名，ADR-0003）
// ========================================
export {
  checkConstraint,
  checkConstraints,
  collectConstraints,
} from './core/constraints/checker';
export type { CheckConstraintsOptions } from './core/constraints/checker';

// ========================================
// 检查器原语 SDK（harness#181，ADR-0035 决策 3 第二半）
// 业务检查器脚本 import 原语组装，瘦身成「事实 ↔ 期望」的绑定。
// 导出纪律 = 只导出存量（现有 checker 真实在用的件），不为想象中的需求新增抽象。
// ========================================
export {
  buildCheckEnv,
  normalizeCheckOutcome,
  formatEvidence,
} from './core/constraints/checkers';
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
} from './core/constraints/checkers';

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
  PassesGateCheckResult,
  PassesGateViolation,
  TestResult,
  TaskTestResult,
} from './types/passes-gate';
export type {
  StepMeta,
  ToolMeta,
  WorkflowMeta,
} from './types/cso';

// ========================================
// 监控（Execution Trace 收集/分析）
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
  pruneTraceLogs,
  TraceAnalyzer,
} from './monitoring';

// ========================================
// 失败处理（错误分类 + 记录 + 违规处理策略）
// ========================================
export {
  ErrorType,
  FailureLevel,
  DEFAULT_FAILURE_LOG_FILE,
  DEFAULT_CLASSIFICATION_RULES,
  DEFAULT_LEVEL_MAPPING,
  ErrorClassifier,
  FailureRecorder,
} from './failure';
export type {
  FailureRecord,
  ErrorClassificationRule,
  ClassificationResult,
  ErrorClassifierConfig,
  FailureRecorderConfig,
} from './failure';

// ========================================
// 上下文管理（会话管理）
// ========================================
export {
  SessionManager,
} from './context';
export type {
  CompactionConfig,
  CompactionLevel,
  ContextSource,
  ContextSourceType,
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
  ReferenceTracker,
  KnowledgeLinter,
  ColdStartImporter,
  KnowledgeHealthScorer,
  KnowledgeAudit,
  DEFAULT_DECAY_CONFIG,
  estimateTokens,
} from './knowledge';
/**
 * 外部来源条目的 prompt 标记标准（harness#161 三层防御第二层 marking 的唯一正本，
 * 定义在 `knowledge/query.ts`）。知识注入编排已归下游编排消费方（定位文档裁决），
 * 本标记作为标准/家具保留公开导出：消费方自行格式化注入内容时以此常量对齐标记，
 * 不得另存字面量。
 */
export { EXTERNAL_SOURCE_MARKER } from './knowledge';
export type {
  KnowledgeEntry,
  KnowledgeStore,
  KnowledgeSubsystem,
  KnowledgeOrigin,
  MaturityLevel,
  MaturityChange,
  DecayConfig,
  SourceRef,
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
} from './knowledge';

// ========================================
// Completion Checkers
// 提交集收尾软观测三纯判定函数：tdd-chain / phase-format / contract-presence。
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
// 发布物完整性自检（#75 N4 收编：harness 自己最知道自己发了什么）
// 清单 = 包声明面（package.json main/exports/bin）推导 + 运行时 extras 随源码维护；
// 下游消费方发布流的 dist 校验改调本能力，不再硬编码 harness dist 内部清单。
// ========================================
export { getCriticalArtifacts, verifyReleaseArtifacts } from './release';
export type { ArtifactIntegrityResult } from './release';

// ========================================
// Harness 运行环境引导（bootstrap 单面；hooks 管线面已随 ADR-0027 删除）
// ========================================
export {
  bootstrapHarness,
  bootstrapHarnessSync,
} from './bootstrap';
export type {
  HarnessBootstrap,
} from './bootstrap';

// ========================================
// Agent 生命周期
// ========================================
export {
  AgentLifecycle,
} from './agents';
export type {
  AgentConfig,
  AgentState,
  AgentStatus,
} from './agents';

// ========================================
// 项目配置类型（config.yml 形状；Loader 属内部 seam 不公开）
// ========================================
export type {
  ProjectConfig,
  MergedConstraintsConfig,
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
