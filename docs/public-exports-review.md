# 公共导出逐符号判定表（ADR-0003 评审材料）

- 日期：2026-08-19
- 配套：`docs/adr/0003-public-exports-explicit-list.md`、防回归测试 `src/__tests__/public-exports.test.ts`

## 口径说明

- 「原导出」= 重构前 `src/index.ts` 的 16 个 `export *` + 显式导出 + 便捷 API 经 TypeScript 模块解析后的完整符号集，共 **377** 个（含纯类型符号；决策预估值 152 为另一口径，以解析结果为准）。
- 「新导出」= 重构后显式清单解析结果，共 **295** 个（其中运行时值导出 123 个，由防回归测试锁定）。
- 判定三问：① 属 harness 定位（约束数据 / 执行引擎 / 注入工具 / 知识基建）？② 实现真实可用（非断链/重复）？③ 无同名冲突？

## 结果统计

| 类别 | 数量 |
|------|------|
| 保留 | 292 |
| 剔除 | 85 |
| 新增（原不在包根） | 3（`CheckConstraintsOptions`、`validateSpec`、`validateAllSpecs`） |

## 一、保留（292，按子系统分组，组内符号全列）

### 约束类型（10）— 定位核心：约束数据形状
`Constraint` `ConstraintId` `ConstraintKind` `ConstraintLevel` `ConstraintTrigger` `ConstraintContext` `ConstraintResult` `ConstraintCheckResult` `IronLawContext` `ConstraintViolationError`

### 约束数据与生效集（9）— 定位核心：约束数据
`IRON_LAWS` `GUIDELINES` `PROMPTS` `getAllConstraints` `getConstraint` `findConstraintsByTrigger` `getEffectiveConstraints` `lintEffectiveConfig` `EffectiveConfigLint`

### 约束检查引擎便捷 API（4）— 定位核心：执行引擎；studio 实际消费
`checkConstraint` `checkConstraints` `checkBeforeExecution` `CheckConstraintsOptions`（新增：options 统一签名的参数类型）

### 约束缓存与注入渲染（8）— 定位核心：注入工具；barrel 测试锁定
`CheckCache` `CheckCacheConfig` `CheckSamplingConfig` `renderConstraintsByTrigger` `RenderConstraintsByTriggerOptions` `CONSTRAINTS_START_MARKER` `CONSTRAINTS_END_MARKER` `renderConstraintsSection`

### 检查点与验证器（25）— 执行引擎：检查点验证/测试门控/CSO，CLI validate 已接线
`Checkpoint` `CheckpointCheck` `CheckpointContext` `CheckpointResult` `CheckConfig` `CheckResult` `CheckType` `CheckpointValidator` `PassesGate` `createPassesGate` `PassesGateConfig` `PassesGateResult` `PassesGateCheckResult` `PassesGateViolation` `PassesGateExtension` `TestResult` `DynamicTask` `TaskTestResult` `ExtensionTestResult` `CSOValidator` `CSOIssue` `CSOValidationResult` `StepMeta` `ToolMeta` `WorkflowMeta`

### 会话启动 / 净室状态（17）— 执行引擎：session 基建，CLI 已接线
`SessionStartup` `createSessionStartup` `DEFAULT_CODE_CHECKPOINTS` `MINIMAL_CHECKPOINTS` `CleanStateManager` `createCleanStateManager` `StartupCheckpoints` `StartupCheckpointType` `StartupCheckpointResult` `CleanStateConfig` `CleanStateResult` `DetectedBug` `TaskListJson` `TaskStepStatus` `SessionInfo` `ExtendedDynamicTask` `ExtendedTaskTestResult`（后两者沿用既有别名，避开与 passes-gate 同名类型冲突）

### Spec 验证（10）— 已接线 spec 故事：core/spec/validator + SpecAcceptanceGate
`SpecValidator` `SpecValidatorConfig` `SpecValidationResult` `BatchSpecValidationResult` `SpecSchemaDefinition` `SpecType` `SpecValidationError` `SchemaLoader` `validateSpec` `validateAllSpecs`（后两者新增：CLI spec 命令使用的纯函数，与 validator 同模块）

### 门禁系统（45）— 定位核心：门禁公共面 = `./gates` 子路径出口全量（ADR-0002 协议）
`Gate` `GateResult` `GateContext` `GateDecision` `GateDecisionStatus` `GateDefinition` `GateCliDefinition` `GateCliOption` `GateRunResult` `GatesConfig` `GATE_DEFINITIONS` `decisionFromResult` `getGate` `listRegisteredGates` `registeredGateCount` `assertGateRegistryClosed` `runGates` `getEffectiveGates` `createCheckerGate` `ReviewGate` `ReviewGateConfig` `SecurityGate` `SecurityGateConfig` `PerformanceGate` `PerformanceGateConfig` `PerformanceThresholds` `ContractGate` `ContractGateConfig` `SpecAcceptanceGate` `SpecAcceptanceGateConfig` `AcceptanceGateContext` `AcceptanceCriteria` `CommandGate` `CommandGateConfig` `CommandBlacklistRule` `createCommandGate` `getCommandGate` `isCommandAllowed` `getCommandRiskLevel` `DEFAULT_COMMAND_BLACKLIST` `createReviewGate` `createSecurityGate` `createPerformanceGate` `createContractGate` `createSpecAcceptanceGate`

### 监控 / Execution Trace（14）— 执行引擎观测面：collector/analyzer 已接线（checker 惰性接线 + CLI status）
`DEFAULT_TRACE_FILE` `ExecutionTrace` `TraceFilter` `TraceSummary` `TraceAnomaly` `TraceCollectorConfig` `TraceAnalyzerConfig` `TraceCollector` `getTraceCollector` `configureTraceCollector` `TraceAnalyzer` `createAnalyzer` `ContextTracker` `ContextAverages`

### 失败处理（22）— 执行引擎：错误分类/记录/违规处理策略，studio 实际消费
`ErrorType` `FailureLevel` `DEFAULT_FAILURE_LOG_FILE` `FailureRecord` `ErrorClassificationRule` `ClassificationResult` `DEFAULT_CLASSIFICATION_RULES` `DEFAULT_LEVEL_MAPPING` `ErrorClassifier` `ErrorClassifierConfig` `createErrorClassifier` `classifyError` `getFailureLevel` `FailureRecorder` `FailureRecorderConfig` `createFailureRecorder` `ConstraintViolationHandler` `executeWithBlock` `executeWithCollect` `executeWithSafeBoolean` `ViolationStrategy` `ViolationHandlingResult`

### 上下文管理（20）— 知识基建：Token 预算/压缩/注入，bootstrap 已接线
`AdaptiveTokenBudget` `TokenBudget` `TokenEstimator` `CompactionConfig` `CompactionLevel` `CompactionResult` `DEFAULT_COMPACTION_CONFIG` `SessionCompaction` `ContextSource` `ContextSourceType` `ContextUsageSnapshot` `SessionCheckpoint` `SessionEvent` `SessionEventType` `SessionHandle` `SessionMessage` `SessionManager` `InjectionConfig` `InjectionResult` `KnowledgeInjector`

### 知识引擎（44）— 定位核心：知识基建，studio 实际消费
`KnowledgeEntry` `KnowledgeStore` `FileKnowledgeStore` `KnowledgeSubsystem` `KnowledgeOrigin` `KnowledgeReference` `KnowledgeQuery` `QueryFilter` `QueryBudget` `QueryResult` `KnowledgeLifecycle` `MaturityLevel` `MaturityChange` `DecayConfig` `DEFAULT_DECAY_CONFIG` `ConsumptionEvent` `ConsumptionMode` `KnowledgeIngest` `IngestOptions` `sanitizeExternalContent` `ReferenceTracker` `ReferenceRecord` `KnowledgeLinter` `LintIssue` `LintIssueType` `ColdStartImporter` `KnowledgeHealthScorer` `KnowledgeLifecycleHooks` `KnowledgeAudit` `AuditRuleName` `AuditAction` `AuditIssue` `AuditReport` `AuditOptions` `migrateKnowledgeEntries` `SourceRef` `DecisionRecord` `ExecutionResult` `IndexEntry` `StorageLayer` `extractCodeStructure` `CodeStructure` `DeclarationInfo` `ImportInfo`

### Completion Checkers（21）— 注入工具：提交集收尾软观测纯函数
`CheckerVerdict` `CommitVerdict` `CommitInput` `CommitFileClassification` `CompletionCheckersConfig` `ContractPresenceContext` `ContractPresenceResult` `PhaseFormatResult` `TddChainResult` `DEFAULT_TEST_GLOBS` `DEFAULT_NONCODE_GLOBS` `matchGlob` `matchAnyGlob` `classifyCommitFiles` `resolveGlobs` `verifyTddChain` `TESTED_BY_RE` `TESTS_NONE_RE` `verifyPhaseFormat` `PHASE_SUBJECT_RE` `verifyContractPresence`

### 工具路径（2）— 注入工具：studio 实际消费
`getRegistryPath` `getToolsDir`

### Hooks 管线（14）— 执行引擎：hook 注册/管线/bootstrap，studio 实际消费
`HookRegistry` `assertHookRegistryClosed` `HookPipeline` `toErrorStrategy` `bootstrapHarness` `bootstrapHarnessSync` `HarnessBootstrap` `HookDefinition` `HookConfig` `HookErrorStrategy` `HookExecutionRecord` `HookPhase` `HookResult` `PipelineResult`

### Agent 生命周期（7）— 执行引擎：生命周期状态机
`AgentLifecycle` `AgentConfig` `AgentEvent` `AgentState` `AgentStatus` `EventHandler` `FallbackStrategy`

### 预设（6）— 约束数据：preset 公共面
`STRICT_PRESET` `STANDARD_PRESET` `RELAXED_PRESET` `getPreset` `applyPreset` `PresetConfig`

### 项目配置类型（17）— 约束数据：config.yml 形状（Loader 类属内部 seam，见剔除表）
`ProjectConfig` `MergedConstraintsConfig` `CustomConstraintDefinition` `GovernanceConfig` `CapabilitiesConfig` `ChangelogConfig` `ChangelogVersionCheck` `TestingGovernanceConfig` `ContextFilesConfig` `ContextDocsCheck` `DocsSyncConfig` `DocFreshnessConfig` `DocFreshnessCheck` `DocDirCheck` `DocRegexCountCheck` `ConstCountActual` `DirCountActual` `GrepCountActual`

## 二、剔除（85）

### safety 子系统（22）— 整目录删除：与已接线 CommandGate/pretool-use-hook 重复的护栏实现，生产断链
`ActAction` `ActFn` `GatherFn` `GatherState` `InputCheckResult` `InputGuardrail` `InputGuardrailConfig` `InputViolation` `OutputGuardrail` `OutputGuardrailConfig` `OutputSafetyCheckResult` `OutputViolation` `RateLimitState` `SafetyCheckResult` `Sandbox` `SandboxCheckResult` `SandboxConfig` `SandboxLevel` `ToolCheckResult` `ToolGuardrail` `ToolGuardrailConfig` `ToolViolation`

### verification 子系统（10）— 整目录删除：验证循环无生产消费者，与「文件驱动 CLI」定位冲突
`FeedbackLoopStatus` `LoopSnapshot` `LoopStatus` `RulesBasedVerification` `VerificationContext` `VerificationLoop` `VerificationLoopConfig` `VerificationResult` `VerificationRule` `VerificationRuleType`

### dashboard 子系统（11）— 整目录删除：数据聚合无生产消费者（status 命令走 TraceAnalyzer 直读）
`computeInterceptRate` `computeKnowledgeFlow` `computeKnowledgeOverview` `ConstraintHeatmap` `ConstraintLayer` `ConstraintStats` `DashboardDataProvider` `DeprecationStatus` `HarnessDashboardData` `KnowledgeFlow` `KnowledgeOverview`

### spec/annotation-checker（7）— 文件删除：标注检查与已接线的 core/spec/validator + SpecAcceptanceGate 重复（迁移为 ConstraintCheck 单独立项）
`AnnotationCheckResult` `AnnotationError` `AnnotationWarning` `checkDirectory` `checkFile` `generateReport` `SpecAnnotation`

### monitoring 已删文件（17）— 断链诊断/性能/知识医生链路：ConstraintDoctor 依赖已删 diagnosis-rules；Performance 链路无消费者；KnowledgeDoctor/KnowledgeEvolver 与 knowledge/doctor.ts 的 KnowledgeHealthScorer 重复。符号来源含 `types/performance.ts`（Performance*/TokenUsage* 8 个）与 `types/monitoring-types.ts`（Diagnosis）——两文件仅服务已删链路，整文件删除、删前核验零引用
`ConstraintDoctor` `ConstraintDoctorConfig` `createDoctor` `Diagnosis` `KnowledgeDoctor` `KnowledgeEvolver` `PerformanceAnalyzer` `PerformanceAnalyzerConfig` `PerformanceAnomaly` `PerformanceCollector` `PerformanceCollectorConfig` `PerformanceSummary` `PerformanceTrace` `PerformanceTraceFilter` `createPerformanceAnalyzer` `TokenUsageRecord` `TokenUsageSummary`

### interceptor（12）— 已由 ADR-0004 整体删除：第二执行引擎零生产调用方，拦截统一由 checkBeforeExecution 承担；enforcement 类型仅服务该 API，随文件 `types/enforcement.ts` 一并删除
`ConstraintInterceptor` `constraintInterceptor` `interceptOperation` `claimOperation` `interceptor` `registerExecutor` `EnforcementId` `EnforcementExecutor` `EnforcementContext` `EnforcementResult` `EnforcementRegistration` `InterceptionResult`

### 内部 seam（6）— 不公开：单例/加载器属内部接线点，studio 清单无消费；`./core` 子路径仍可达
`ConstraintChecker` `constraintChecker` `ProjectConfigLoader` `loadRawProjectConfig` `getCapabilitiesMode` `CapabilitiesMode`

## 三、同名 checkConstraints 整治记录

- 重构前：core 版 `(context, customConfig?)`（位置参数）与包根版 `(context, options?)`（options 对象，含 `onTrace`/`customConfig`）同名并存，`export *` 下包根显式函数遮蔽 core 版——同名遮蔽的第二次咬人。
- 重构后：实现统一为 options 对象签名（`CheckConstraintsOptions`），定义在 `core/constraints/checker.ts`，包根与 `./core` 子路径导出同一实现；位置参数版不复存在。
- per-request `customConfig` 能力保留：`checkConstraints(options.customConfig)`、`checkConstraint(id, ctx, customConfig)`、`checkBeforeExecution(ctx, customConfig)`（O4 工单语义不丢）。
