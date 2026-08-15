# studio→harness 边界盘点（wayfinder #28）

> 日期：2026-08-15
> 范围：studio 对 `@dommaker/harness` 的完整消费面 + studio 本地 harness 包装层（`packages/studio-shared/src/harness/**`，~1432 行）逐文件职责
> 结论导向：只盘点分类，回收裁决留给后续 HITL grilling 票。每条结论带 `文件路径:行号` 证据。
> 仓库基线：harness @ `57f8e07`；studio @ 本地 master（ahead origin/master 15）。

---

## 0. 结论摘要

| 维度 | 数值 |
|------|------|
| studio 引用 `@dommaker/harness` 的源文件数（排除 dist/node_modules/测试 mock） | ~35 个（含 scripts/tools） |
| 消费的 harness 导出符号（去重后） | ~70 个（值导出 ~50 + 类型导出 ~20） |
| 包装层文件数（`studio-shared/src/harness/**`，含 auditor） | 16 个 `.ts`（1432 行） |
| 回收候选清单条目数 | **6** |
| 其中 A（留 studio，业务耦合） | 0（候选表只收 B/C，A 项见 §2 逐文件表） |
| 其中 B（回收候选，通用基建） | **2** |
| 其中 C（灰色地带，待 grilling） | **4** |

B 项：约束检查采样缓存（`runtime/cache.ts`）、token 估算重复（`session-metrics.ts` 的 `estimateTokens`）。
C 项：prompt 段渲染（`prompt-injection.ts`）、per-hook 运行时配置（`hooks/config.ts`）、决策审计台账（`hooks/audit.ts`）、HTTP 响应 TTL 缓存（`apps/api/.../harness/runtime.ts` 的 `getCached/setCache`）。

核心判断：**studio 对 harness 的消费绝大部分是「直接调用 harness 公共 API」而非「本地重造」**；真正有回收价值的增量逻辑只有约束检查采样缓存一处；其余候选要么 harness 已有近似（重复造），要么耦合 studio 业务拓扑（角色路由/EventBus/编排约定），属于灰色地带。

---

## 1. studio→harness API 消费全表

按「包 × 导入符号」汇总。符号来源以 `import ... from '@dommaker/harness'` 为准；动态 `import('@dommaker/harness')` 标注为 `(dynamic)`；`require.resolve('@dommaker/harness/...')` 标注为 `(resolve)`。

### 1.1 apps/api（REST facade + 业务模块）

| 消费文件 | 导入符号 | 证据 |
|----------|----------|------|
| `apps/api/src/modules/admin/docs-freshness.routes.ts` | `checkConstraints` | :12 |
| `apps/api/src/modules/agents/knowledge/knowledge-cold-start.ts` | `ColdStartImporter` | :9 |
| `apps/api/src/modules/agents/monitor/monitor-reports.ts` | `KnowledgeAudit`, `FileKnowledgeStore` (dynamic) | :305, :333 |
| `apps/api/src/modules/agents/monitor/monitor-system-probes.ts` | `KnowledgeLinter`, `KnowledgeHealthScorer`, `ReferenceTracker` | :20 |
| `apps/api/src/modules/capabilities/routes.ts` | `getRegistryPath`, `getToolsDir` | :5 |
| `apps/api/src/modules/distill/distill-service.ts` | `KnowledgeStore`, `KnowledgeEntry`, `SourceRef` (type) | :31 |
| `apps/api/src/modules/evolution/applier.ts` | `GUIDELINES`, `IRON_LAWS`, `PROMPTS` | :27 |
| `apps/api/src/modules/evolution/signals.ts` | `ExecutionTrace` (type) | :14 |
| `apps/api/src/modules/harness/agents.routes.ts` | `AgentLifecycle` (type) | :17 |
| `apps/api/src/modules/harness/diagnostics.routes.ts` | `ErrorClassifier`, `FailureRecord` | :36, :65 |
| `apps/api/src/modules/harness/iron-laws.routes.ts` | `IronLawContext` (type) | :4 |
| `apps/api/src/modules/harness/runtime.ts` | `TraceCollector`, `TraceAnalyzer`, `KnowledgeStore`, `KnowledgeQuery` (type) + 整个模块 `typeof import('@dommaker/harness')` (dynamic) | :14-19, :22, :29 |
| `apps/api/src/modules/harness/traces.routes.ts` | `ExecutionTrace`, `TraceFilter` (type) | :14 |
| `apps/api/src/modules/knowledge/knowledge-service.ts` | `KnowledgeEntry`, `KnowledgeStore`, `KnowledgeIngest`, `KnowledgeLifecycle`, `KnowledgeLinter`, `QueryFilter`, `MaturityLevel`, `KnowledgeSubsystem` (type) | :26-35 |
| `apps/api/src/modules/knowledge/knowledge-singletons.ts` | `FileKnowledgeStore`, `KnowledgeIngest`, `KnowledgeLifecycle`, `KnowledgeQuery`, `KnowledgeInjector`, `KnowledgeLinter`, `ReferenceTracker` + `KnowledgeEntry`, `KnowledgeSubsystem`, `MaturityLevel` (type) | :18-19 |
| `apps/api/src/modules/knowledge/knowledge-bus.service.ts` | `KnowledgeStore`, `KnowledgeIngest`, `KnowledgeSubsystem`, `DecisionRecord` (type) | :30-31 |
| `apps/api/src/modules/knowledge/knowledge-types.ts` | `KnowledgeEntry`, `KnowledgeStore`, `KnowledgeIngest`, `KnowledgeLifecycle`, `KnowledgeLinter`, `MaturityLevel`, `KnowledgeSubsystem` (type) | :9-17 |
| `apps/api/src/modules/knowledge/evolution.service.ts` | `MaturityLevel` (type) | :17 |
| `apps/api/src/modules/knowledge/engine/unified-query.ts` | `FileKnowledgeStore` + `KnowledgeStore`, `KnowledgeEntry`, `QueryFilter` (type) | :10-12 |
| `apps/api/src/modules/knowledge/conversation-extraction.ts` | `KnowledgeLinter`, `KnowledgeIngest`, `KnowledgeSubsystem` (type) | :10 |
| `apps/api/src/modules/knowledge/conversation-extractor.ts` | `KnowledgeLinter`, `KnowledgeIngest`, `KnowledgeSubsystem` (type) | :13 |
| `apps/api/src/modules/knowledge/decision-chain-extractor.ts` | `KnowledgeEntry` (type) | :12 |
| `apps/api/tests/harness-integration.test.ts` | `checkConstraints`, `ConstraintViolationError` | :10 |
| `apps/api/tests/review-gate.test.ts` | `ReviewGate` + `GateContext`, `GateResult` (type) | :8-9 |

> 注：`apps/api/src/modules/harness/__tests__/*` 各测试文件 mock 了额外符号（`getEffectiveConstraints`、`CSOValidator`、`DashboardDataProvider`、`TokenEstimator`、`SessionManager`、`InputGuardrail`、`OutputGuardrail`、`Sandbox`、`checkFile`、`ConstraintDoctor`、`TraceCollector`、`TraceAnalyzer`），均为 `vi.mock('@dommaker/harness', ...)` 注入，非真实消费，但反映 `apps/api/src/modules/harness/routes.ts` 及子路由的运行时依赖面（见测试文件头注释，如 `routes.test.ts:8`、`sessions.routes.test.ts:4`、`guards.routes.test.ts:4`、`traces.routes.test.ts:4`）。

### 1.2 packages/studio-shared（包装层）

| 文件 | 导入符号 | 证据 |
|------|----------|------|
| `src/harness/index.ts` | `constraintChecker`, `getAllConstraints`, `getConstraint`, `checkConstraint`, `IRON_LAWS`, `GUIDELINES`, `TIPS`, `CheckpointValidator`, `FileKnowledgeStore`, `KnowledgeQuery`, `ReferenceTracker`, `KnowledgeLinter`, `InputGuardrail`, `OutputGuardrail`, `ToolGuardrail`, `Sandbox`, `TokenBudget`, `SessionCompaction`, `AgentLifecycle` + `Constraint`, `ConstraintResult`, `ConstraintContext`, `ConstraintCheckResult`, `Checkpoint`, `CheckpointResult`, `CheckpointContext` (type) | :8-36 |
| `src/harness/index.ts` | `HarnessBootstrap` (type) | :267 |
| `src/harness/hooks/agent.hooks.ts` | `checkBeforeExecution`, `getTraceCollector` + `ConstraintContext` (type) | :7-8 |
| `src/harness/hooks/completion.hooks.ts` | `PassesGate`, `getTraceCollector`, `createFailureRecorder`, `ErrorType`, `FailureLevel` + `TestResult` (type) | :7-8 |
| `src/harness/hooks/goal.hooks.ts` | `checkBeforeExecution` + `ConstraintContext` (type) | :7-8 |
| `src/harness/hooks/register.ts` | `HookRegistry`, `HookDefinition` (type) | :8 |
| `src/harness/prompt-injection.ts` | `getAllConstraints` + `ConstraintTrigger` (type) | :8-9 |
| `src/harness/runtime/bootstrap.ts` | `bootstrapHarness`, `HookRegistry`, `HookPipeline` + `HarnessBootstrap`, `HookDefinition` (type) + `bootstrapHarnessSync` (dynamic) | :8-9, :35 |
| `src/index.ts` | `ConstraintLevel`, `ConstraintContext`, `ConstraintResult` (type re-export) | :34 |
| `src/node.ts` | `ConstraintLevel`, `ConstraintContext`, `ConstraintResult` (type re-export) | :17 |

### 1.3 packages/studio-spec

| 文件 | 导入符号 | 证据 |
|------|----------|------|
| `src/services/gate-checker.service.ts` | `Checkpoint`, `CheckpointContext`, `CheckpointValidator` (type) + `CheckpointValidator.getInstance()` (dynamic) | :26, :37-38 |

### 1.4 packages/studio-agent

| 文件 | 导入符号 | 证据 |
|------|----------|------|
| `src/services/provider-hooks.ts` | `CommandGate`（经 `require.resolve('@dommaker/harness')` → `dist/gates/command.js`） | :28-29, :49 |
| `src/services/worktree-resolver.ts` | `@dommaker/harness/package.json`（定位 `templates/node-api`） | :189 |

### 1.5 packages/studio-capability

| 文件 | 导入符号 | 证据 |
|------|----------|------|
| `src/services/capability.service.ts` | `getRegistryPath` | :12 |

### 1.6 scripts/tools（CI/本地工具）

| 文件 | 导入符号 | 证据 |
|------|----------|------|
| `scripts/tools/spec-gate.ts` | `ArchitectureConstraintEngine`, `loadArchitectureRules`, `ArchitectureContext`, `checkCrossProjectContracts`, `checkDocCodeConsistency`, `CrossProjectContext`, `checkDirectory`, `generateReport` | :14-27 |
| `scripts/tools/cross-project-check.ts` | `checkCrossProjectContracts`, `checkDocCodeConsistency`, `CrossProjectContext` | :15-19 |
| `scripts/tools/architect-check.ts` | `runArchitectureCheck`, `ArchitectureContext` | :15 |
| `scripts/harness-upgrade.ts` | 仅 `npm view @dommaker/harness version`（工具脚本，非运行时 import） | :129 |

**观察**：harness 全部符号均为公共 API 导出（见 `harness/src/index.ts:23-108` 的 `export * from './...'`），studio 无一处 import harness 的 `dist/` 内部路径（唯一例外是 `provider-hooks.ts` 经 `require.resolve` 定位 `dist/gates/command.js`，见 §7 风险）。

---

## 2. 包装层逐文件分析表（`studio-shared/src/harness/**`）

性质三分类：**封装**（对 harness 能力的透传/缓存，无业务增量）、**业务**（studio 自有编排逻辑）、**通用基建**（与 studio 业务无关、harness 可能该有）。

| 文件（行数） | 做什么 | 依赖的 studio 业务模型 | 性质 | 分类 |
|--------------|--------|------------------------|------|------|
| `index.ts` (270) | `ConstraintService`（`getAllConstraints`/`getConstraint`/`checkConstraint`/`constraintChecker` 透传 + 一组 `getLaw*`/`checkLaw` 废弃别名，:42-170）；`CheckpointService`（`CheckpointValidator` 单例透传，:179-225）；`SafetyService`（`Input/Output/ToolGuardrail`+`Sandbox` 组合透传，:239-256）；re-export `formatConstraintsForPrompt`/`parseSessionMetrics`/`bootstrapHarness`（:173,:259,:266） | 无（纯 harness API 整形；`getLaw*` 别名是 studio 历史命名遗留） | 封装（纯透传，无增量逻辑） | **A**（留 studio；建议删薄为直接引用 harness，见 §7） |
| `auditor/auditor-types.ts` (171) | Auditor↔Knowledge Keeper↔ConstraintEvolver 三角色协议：`AuditorConclusion`/`KKConsumptionRule`/`ConstraintEffectReport`/`ConstraintEffectAction` + `decideConstraintAction` 决策函数（:15-171） | 重度：Auditor 结论（daily/weekly 报告）、约束进化效果评估、消费规则（BP-013/BP-014） | 业务（零 harness import） | **A** |
| `session-metrics.ts` (98) | `parseSessionMetrics` 解析 Claude CLI `--output-format json` 的 usage/modelUsage 聚合成 `SessionMetrics`（:42-91）；`estimateTokens` = `ceil(chars/4)`（:96-98） | Claude CLI 输出格式（provider/agent-runtime 关注，非 harness 约束框架） | parse=业务；`estimateTokens`=通用基建（重复） | **A**（整体）；`estimateTokens` 单列 → **B** |
| `hooks/agent.hooks.ts` (97) | `beforeAgentExecute`：`checkBeforeExecution` 前注入 studio 字段（`hasWorktree`/`hasVerificationEvidence`/`hasRequirement`…，:17-32）；`buildAgentConstraintPrompt`：按 `executor` 角色渲染约束 + CLAUDE.md 去重 + 工具风险段（:36-73）；`afterAgentComplete`：写 trace（:75-97） | 重度：executor 角色、worktree 语义、completion-gates 前置字段、trace 记录 | 业务 | **A** |
| `hooks/completion.hooks.ts` (58) | `checkBeforeTaskComplete`：`PassesGate` 包装（:11-22）；`afterReview`：审查结果写 `TraceCollector` + 失败写 `createFailureRecorder`（:25-57） | 重度：任务完成门、review 阶段、失败台账 | 业务 | **A** |
| `hooks/goal.hooks.ts` (50) | `beforeGoalCreate`：`checkBeforeExecution(goal_creation)` 采样检查（:13-25）；`beforeAgentDispatch`：`checkBeforeExecution(code_implementation)` + 前置字段（:28-49） | 重度：Goal 创建、Agent dispatch 编排、采样缓存（引 `runtime/cache`） | 业务 | **A** |
| `hooks/pr.hooks.ts` (12) | `afterPrCreated` 占位（仅 log，:10-12） | PR 阶段（待 GateChecker 接入） | 业务（占位） | **A** |
| `hooks/audit.ts` (65) | `recordDecision`/`recordDecisions`：决策级审计事件写 `~/.harness/audit/{date}.jsonl`（追加不可变）+ `eventBus.publish('events:audit')`（:45-65） | 中度：studio `eventBus`（DB 持久化在 API 层 audit-subscriber） | 通用基建（台账）+ studio 耦合（EventBus） | **C** |
| `hooks/config.ts` (80) | per-hook 运行时配置：`DEFAULTS`（name/enabled/blocking，:21-37）+ `HARNESS_HOOK_DISABLE` env 禁用（:40-43）+ `safeCallHook`（blocking→throw，否则 warn，:58-71） | 中度：studio hook 命名清单 + 编排约定（哪个 hook 阻断/非阻断） | 通用基建（hook 注册/配置模式）+ studio 约定 | **C** |
| `hooks/register.ts` (67) | `registerAllHooks`：把 7 个 studio hook 函数转成 harness `HookDefinition` 注册进 `HookRegistry`（:24-44）；`toHookDef` 转换（:46-67） | 中度：studio hook 清单 + `checkBeforeTaskComplete` 的 `{allowed}` 返回协议 | 业务（注册表是 studio hook 清单）；`toHookDef` 转换器偏通用 | **A** |
| `hooks/index.ts` (15) | barrel re-export（:10-15） | 无 | 封装（barrel） | **A** |
| `runtime/bootstrap.ts` (58) | `bootstrapHarness`：调 harness `bootstrapHarness(root)`，失败 fallback 到 `bootstrapHarnessSync`，再 `registerAllHooks`（:18-40）；`getHarness`/`getPipeline`/`isHarnessInitialized` 访问器（:45-58） | 轻度：`registerAllHooks` 是 studio hook 清单 | 封装（薄包装 + fallback + 注册钩子） | **A** |
| `runtime/cache.ts` (80) | `cachedCheck`（TTL 30s 缓存，:31-44）；`sampledCheck`（每 N 次执行 1 次完整检查，其余返回缓存/默认通过，:53-69）；`clearConstraintCache`/`getCacheStats`（:72-80） | 无（纯约束检查缓存 + 采样策略） | 通用基建（harness 有近似 `CheckCache`，缺采样） | **B** |
| `prompt-injection.ts` (71) | `formatConstraintsForPrompt(role)`：`ROLE_TRIGGERS`（7 角色→`ConstraintTrigger` 映射，:13-21）+ 按 iron_law/guideline/tip 分组渲染 prompt 段（:27-70） | 重度：studio Agent Network 角色词表（analyst/executor/integration/reviewer/deploy/monitor/triage） | 渲染格式=通用；角色路由=studio 拓扑 | **C** |

---

## 3. 其他包适配层分析

| 文件 | 消费的 harness API | 自己加的逻辑 | 分类 |
|------|--------------------|--------------|------|
| `packages/studio-spec/src/services/gate-checker.service.ts` (462) | `CheckpointValidator.getInstance()`（动态）+ `Checkpoint`/`CheckpointContext` 类型（:26, :37-38） | 完整 L1-L4 门禁策略（`GATE_POLICIES`，:84, :115-117）；业务检查点 `spec_format`/`test_coverage`/`api_schema`/`architecture`/`ac_complete`（:142-164）；harness 检查点分流 `file_exists`/`file_contains`/`command_success`/`output_matches`（:237-277）；harness 不可用时 L1/L2 优雅降级、L3/L4 阻断（:178-199） | **A**（spec 变更门禁是 studio 业务；harness 仅提供通用 check 引擎） |
| `packages/studio-agent/src/services/provider-hooks.ts` (224) | `CommandGate`（经 `require.resolve` → `dist/gates/command.js`，:27-30, :49-51） | 把 harness 命令黑名单落到 claude/codex/kimi 三个 provider 的执法面：claude `permissions.deny`（:73-99）、codex `.codex/hooks.json`（:104-127）、kimi per-worktree home + `config.toml [[hooks]]`（:131-202）；幂等写入 + fail-open（:37-58, :211-224） | **A**（provider 执法配置是 studio-agent 业务；黑名单规则本身在 harness，不在此改） |
| `packages/studio-agent/src/services/worktree-resolver.ts` (493) | `@dommaker/harness/package.json`（定位 `templates/node-api/.harness`，:189） | git worktree 创建/复用/清理（:46-159）；harness 配置传播到 worktree（`.harness` 三件 + `.claude/settings.json`，:164-247）；依赖硬链接缓存 `ensureDeps`（:309-396）；WU/PMO 专属 worktree（:400-492） | **A**（worktree 生命周期是 studio-agent 核心业务；harness 仅提供模板路径） |
| `packages/studio-capability/src/services/capability.service.ts` (354) | `getRegistryPath`（:12, :67） | 能力 CRUD + `syncFromRegistry`（FileStore JSON 存储，:63-353）；`CAPABILITY_COST` 消耗配置（:57-61） | **A**（能力管理是 studio 业务；harness 仅提供 registry.json 路径） |

---

## 4. 通用基建扫描（疑似「与 studio 业务无关、harness 可能该有」）

| 候选能力 | 位置 | 理由 |
|----------|------|------|
| 约束检查采样缓存 | `studio-shared/src/harness/runtime/cache.ts` | 通用 TTL 缓存 + 「每 N 次采样一次」策略，与 studio 业务无关；仅被 `goal.hooks.ts:16` 的 `beforeGoalCreate` 消费 |
| token 估算 | `studio-shared/src/harness/session-metrics.ts:96-98` | `ceil(chars/4)` 是通用 token 估算，harness 已有 `TokenEstimator.estimateText`（`harness/src/context/token-budget.ts:16`） |
| prompt 段渲染 | `studio-shared/src/harness/prompt-injection.ts:27-70` | iron_law/guideline/tip → markdown 渲染是通用；harness 已有 `injection-renderer.ts`（`renderConstraintsSection`，`harness/src/core/constraints/injection-renderer.ts:25`） |
| hook 注册/配置模式 | `studio-shared/src/harness/hooks/config.ts` + `register.ts:46-67` | per-hook enable/blocking + `safeCallHook` 与 harness `HookDefinition` 的 `enabled`/`errorStrategy`/`sampleRate`（`harness/src/hooks/types.ts:23-38`）重叠 |
| 决策审计台账 | `studio-shared/src/harness/hooks/audit.ts` | 追加不可变 JSONL 决策审计是通用台账；harness 无对应（`knowledge/audit.ts` 是知识质量审计，`failure/recorder.ts` 是失败记录，均非决策审计） |
| 指标聚合 | `studio-shared/src/harness/session-metrics.ts:59-91` | Claude CLI usage/modelUsage 聚合为结构化指标；属 provider 输出解析，harness 有 `analyze-sessions`/`session-mining` 但面向 transcript 挖掘，非 CLI JSON |
| HTTP 响应 TTL 缓存 | `apps/api/src/modules/harness/runtime.ts:45-54` | `getCached`/`setCache` 通用 TTL 响应缓存；与 harness `CheckCache`（`harness/src/core/constraints/check-cache.ts:24`）同构，但语义是 HTTP 层缓存 |

---

## 5. 对照 harness 现状（逐候选）

| 候选 | harness 是否已有 | 结论 |
|------|------------------|------|
| 采样缓存 `runtime/cache.ts` | 有近似：`CheckCache`（`harness/src/core/constraints/check-cache.ts:24`，TTL 5000ms，namespace 化，`get`/`getSync`/`invalidate`）。**缺采样**（`CheckCache` 无「每 N 次执行一次」语义）；harness 的采样在 `HookPipeline.executeOne` 的概率采样（`harness/src/hooks/pipeline.ts:119-132`），与 studio 的「每 N 次」计数采样语义不同 | **harness 缺失（值得收编）**：studio 的计数采样策略可上收为 `CheckCache` 扩展或 hook 级 `sampleRate` 语义统一 |
| token 估算 `estimateTokens` | 已有：`TokenEstimator.estimateText`（`harness/src/context/token-budget.ts:16`，含 CJK 感知等更细算法，测试见 `token-budget.test.ts:10-35`） | **harness 已有（studio 重复造）**：删 `estimateTokens` 改用 harness `TokenEstimator` |
| prompt 段渲染 `prompt-injection.ts` | 有近似：`renderConstraintsSection`（`harness/src/core/constraints/injection-renderer.ts:25`，CLAUDE.md 注入段，iron_law/guideline/prompt 三组，无 role 路由）；文件头自述「原在 harness 中，迁至 studio-shared 以解耦管道拓扑」（:5） | **harness 已有渲染、缺 role 路由**：渲染格式应归一，role→trigger 路由（`ROLE_TRIGGERS`，:13-21）是 studio Agent Network 拓扑，不回收 |
| per-hook 配置 `hooks/config.ts` | 有近似：`HookDefinition.enabled`/`errorStrategy`/`sampleRate`（`harness/src/hooks/types.ts:23-38`）+ `HookRegistry.setEnabled`（`harness/src/hooks/registry.ts:68-73`） | **harness 已有（studio 平行造一套）**：`DEFAULTS`+`HARNESS_HOOK_DISABLE`+`safeCallHook` 与 harness 的 errorStrategy/enabled 双轨，需 grilling 是否归一 |
| 决策审计台账 `hooks/audit.ts` | 无对应：`knowledge/audit.ts`=知识质量审计（6 维度，`harness/src/knowledge/audit.ts:20-101`）；`failure/recorder.ts`=失败记录（`harness/src/failure/recorder.ts:37`）。均非「决策级审计事件」 | **harness 缺失（值得收编，但耦合 studio EventBus）**：台账落盘逻辑通用，`eventBus.publish('events:audit')` 是 studio 侧持久化触发 |
| 指标聚合 `session-metrics.ts` | 无对应：`analyze-sessions`（`harness/src/cli/commands/analyze-sessions.ts`）+ `session-mining/*` 面向 transcript 挖掘；无 Claude CLI `--output-format json` usage 聚合 | **harness 不该有（业务耦合）**：Claude CLI 输出解析是 agent-runtime/provider 关注，不属约束框架 |
| HTTP TTL 缓存 `runtime.ts:45-54` | 有近似：`CheckCache` 同构（TTL + Map） | **harness 不该有（业务耦合）**：HTTP 响应缓存是 API 层关注，harness 不提供 Web 层 |

---

## 6. 回收候选清单表

> 依赖面 = 谁 import 它（仅计 studio 生产代码，不计测试）。迁移代价：低（单文件/单符号替换，无行为变化）、中（需 API 对齐/行为可能变化）、高（跨仓改动 + 语义重组）。

| # | 现状路径 | 职责 | harness 对应 | 依赖面 | 迁移代价 | 风险 | 分类 |
|---|----------|------|--------------|--------|----------|------|------|
| 1 | `studio-shared/src/harness/runtime/cache.ts` | 约束检查 TTL 缓存 + 「每 N 次采样一次」 | `CheckCache`（缺采样）；hook 级概率采样在 `HookPipeline` | `hooks/goal.hooks.ts:16`（`sampledCheck`） | 中 | 采样语义不一致（studio 计数采样 vs harness 概率采样）；上收需定义统一 `sampleRate` 语义，否则 studio 采样命中率退化 | **B** |
| 2 | `studio-shared/src/harness/session-metrics.ts`（仅 `estimateTokens` :96-98） | `ceil(chars/4)` token 估算 | `TokenEstimator.estimateText`（更细，CJK 感知） | `apps/api/.../knowledge-service.ts:36`（`estimateTokens` 经 studio-shared re-export） | 低 | 算法替换可能导致 token 预算口径变化；需对比 `estimateText` 与 `chars/4` 差异 | **B** |
| 3 | `studio-shared/src/harness/prompt-injection.ts` | role→trigger 路由 + 约束 prompt 段渲染 | `injection-renderer.ts`（渲染）；无 role 路由 | `hooks/agent.hooks.ts:38`（`buildAgentConstraintPrompt`）、`harness/index.ts:173`（re-export） | 中 | role 词表（`AgentRole`，:11）是 studio Agent Network 概念；若只收编渲染格式，需拆「渲染（通用）」与「路由（studio）」两层 | **C** |
| 4 | `studio-shared/src/harness/hooks/config.ts` | per-hook enabled/blocking + env 禁用 + `safeCallHook` | `HookDefinition.enabled`/`errorStrategy` + `HookRegistry.setEnabled` | 全部 hook 文件（`agent/completion/goal/pr`）+ `register.ts:52` | 中 | 双轨配置并存，归一需对齐「阻断/非阻断」与 `errorStrategy` 映射；`HARNESS_HOOK_DISABLE` 是 studio 运维约定 | **C** |
| 5 | `studio-shared/src/harness/hooks/audit.ts` | 决策级审计台账（`~/.harness/audit/{date}.jsonl` + EventBus） | 无（`knowledge/audit.ts`/`failure/recorder.ts` 均非决策审计） | `hooks/index.ts:14` re-export；消费方见 `apps/api` audit-subscriber（EventBus 侧） | 中 | 落盘逻辑通用，`eventBus.publish('events:audit')` 是 studio 持久化契约；收编需解耦 EventBus 或提供回调注入 | **C** |
| 6 | `apps/api/src/modules/harness/runtime.ts`（`getCached`/`setCache` :46-54） | 慢端点 HTTP 响应 TTL 缓存 | `CheckCache`（同构 TTL） | harness 各子路由（traces/diagnostics/dashboard 等） | 低 | HTTP 层缓存不属 harness 约束框架；收编为 `CheckCache` 只是换实现，无语义收益 | **C** |

**分布**：B = 2（#1、#2），C = 4（#3–#6），A = 0（候选表只收 B/C；留 studio 的 A 项见 §2/§3 表）。

---

## 7. studio 侧移交观察（供 HITL grilling）

1. **消费面是「直接调用」，不是「本地重造」**：~70 个符号全部来自 harness 公共 API（`harness/src/index.ts:23-108` 的 `export *`）。真正值得回收的增量逻辑只有 1 处（采样缓存 #1）。

2. **`index.ts` 是一层纯透传 facade，建议删薄而非回收**：`ConstraintService`/`CheckpointService`/`SafetyService`（`index.ts:42-256`）无业务增量，只是给 harness API 加了 studio 命名（含 `getLaw*`/`checkLaw` 废弃别名，:83-122）。回收无意义（harness 已有底层），正确动作是 studio 内删薄为直接 `import '@dommaker/harness'`。

3. **`provider-hooks.ts` 触碰 harness 内部路径，是脆弱耦合**：`resolveCommandGatePath()` 用 `require.resolve('@dommaker/harness')` 定位 `dist/gates/command.js`（`provider-hooks.ts:27-30`）。harness 已导出 `CommandGate`/`createCommandGate`/`getCommandGate`（`harness/src/gates/command.ts:198,413,425`），studio 应改用公共导出而非 `dist/` 内部路径。这是 harness 侧可改进点（或 studio 侧修正），非回收候选。

4. **`prompt-injection.ts` 自述「从 harness 迁出」是既有共识**：文件头 `:5` 明确「此模块原在 harness 中，迁至 studio-shared 以解耦管道拓扑」。grilling 时需确认该迁移共识是否仍然成立——若 harness 已补齐 role 路由能力则反向回收，否则维持 studio 持有。

5. **audit 台账与 failure 记录是两套东西，勿混淆**：studio `hooks/audit.ts` 的决策审计（`~/.harness/audit/{date}.jsonl`）≠ harness `failure/recorder.ts` 的失败记录（`.harness/logs/failures.log`）≠ harness `knowledge/audit.ts` 的知识质量审计。收编 #5 时三者语义边界要明确。

6. **harness 的「No business logic」原则（`harness/CLAUDE.md` Design Principles）是分类基准**：凡涉及 goal/step/WU 编排、Agent Network 角色、spec 变更分级、provider 执法配置、worktree 生命周期的，一律 A（留 studio）；只有「通用缓存/渲染/注册簿记/台账」这类纯能力才有回收空间。

---

## 附：证据索引（harness 侧）

- 公共导出面：`harness/src/index.ts:23-108`
- `CheckCache`：`harness/src/core/constraints/check-cache.ts:24-96`
- `injection-renderer`：`harness/src/core/constraints/injection-renderer.ts:25-44`
- `TokenEstimator`：`harness/src/context/token-budget.ts:16`
- `HookDefinition`/`HookRegistry`/`HookPipeline`：`harness/src/hooks/types.ts:23-38`、`registry.ts:9-88`、`pipeline.ts:16-157`
- `bootstrapHarness`/`bootstrapHarnessSync`：`harness/src/hooks/bootstrap.ts:66-134`
- `CommandGate`：`harness/src/gates/command.ts:198-446`
- `FailureRecorder`/`createFailureRecorder`：`harness/src/failure/recorder.ts:37-201`
- `KnowledgeAudit`：`harness/src/knowledge/audit.ts:353-697`
- `ColdStartImporter`：`harness/src/knowledge/import.ts:76`
- `KnowledgeHealthScorer`：`harness/src/knowledge/doctor.ts:24`
- `getRegistryPath`/`getToolsDir`：`harness/src/tools/paths.ts:6-14`
- `PassesGate`：`harness/src/core/validators/passes-gate.ts:53`
- `getEffectiveConstraints`：`harness/src/core/effective-constraints.ts:25`
- `checkDirectory`/`generateReport`：`harness/src/spec/annotation-checker.ts:286,299`
