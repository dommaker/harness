# Studio 对 @dommaker/harness 的完整使用面快照（重构护栏）

> 调研日期：2026-08。扫描范围：`/root/projects/studio`（排除 node_modules、dist）。
> studio 锁定版本：`"@dommaker/harness": "^0.16.6"`（根 package.json + packages/studio-shared 均声明）。
> 用途：harness 大刀阔斧重构时，本文列出 studio 的每一个使用点与影响级别，并在末尾给出不可破坏的护栏清单。
>
> **影响级别定义**：
> - **破坏性**：删除/改名后 studio 直接运行时报错、测试红、CI 红或数据丢失，无现成降级路径。
> - **可适配**：studio 需要改代码才能跟上（有 try/catch 降级、mock、或仅文档提及），但不会静默损坏。
> - **无影响**：studio 不实际触达，或纯属 studio 自有代码（仅命名含 harness）。

---

## 0. 关键结论（先读这里）

studio 对 harness 的消费分四类，**全部真实且在生产路径上**：

1. **CLI**（7 个真实命令形态）：`init`、`check`、`sync-docs`、`sync-docs --agents`、`sync-docs --check --agents`、`constraints --json`、`update-user-model --days N --json`，外加一个**任意子命令透传**（`studio harness <...>`）。
2. **API import**：约 60+ 个具名符号，横跨约束引擎、检查点/门禁、hooks 管线、**知识引擎（最大面）**、trace/进化、安全护栏、上下文管理、Agent 生命周期、spec 注解检查、架构/跨工程检查、错误分类、仪表盘、路径工具。
3. **包内文件/布局**：`package.json`（版本、`require.resolve`）、`templates/node-api/.harness`（worktree 拷贝）、`src/core/constraints/definitions.ts`（rule-scanner 正则解析）、CJS `require()` 入口（upgrade 脚本 Object.keys 内省）。
4. **生成物契约**：`.harness/config.yml`（version 字段被正则解析）、`AGENTS.md`（PRESERVE 机制）、`CLAUDE.md`（HARNESS_CONSTRAINTS 标记块）、`CONTEXT.md`（占位行/STALE 标记）、`.harness/logs/traces.log`（JSONL 格式）、`.harness/knowledge/`（含 index.json/_index.md）。

**最脆弱的三类**（重构最易踩雷）：
- 知识引擎类构造器/方法签名（studio 在 ~10 个文件里直接 `new` 并调深层方法）；
- `package.json` 的 `version` 字段 + `.harness/config.yml` 的 `version:` 行（postinstall 自动 init 的比对依据）；
- `sync-docs --agents` 的 PRESERVE 块语义 + `--check` 漂移判定（CI 治理步与 gen-agents-md.mjs 都押在它上面）。

---

## 1. CLI 命令使用

### 1.1 `npx harness init` — 破坏性
- **位置**：`scripts/harness-sync.js:40`（`execSync('npx harness init', ...)`）
- **触发**：根 `package.json` 的 `postinstall` 与 `prepare` → `node scripts/harness-sync.js`。
- **前置契约**：
  - 读 `node_modules/@dommaker/harness/package.json` 的 `version`（harness-sync.js:11-18）。
  - 读 `.harness/config.yml`，用正则 `/version:\s*(.+)/` 提取版本（harness-sync.js:20-29）。
  - 两者不一致才跑 `init`；一致则跳过。
- **影响**：`init` 命令被删/改名 → 每次 `pnpm install` 报错（虽 try/catch 静默，但 `.harness` 不再同步）；`package.json` 无 `version` 或 config.yml 无 `version:` 行 → 版本比对失效，可能反复 init 或从不 init。**破坏性**。

### 1.2 `npx harness check` — 破坏性
- **位置**：
  - `scripts/release.ts:53`（`sh('npx harness check 2>&1 || true')`，解析 stdout 含「通过」/「passed」/「异常」）。
  - `.github/workflows/ci.yml:27`（治理步，`npx harness check && ...`，**依赖退出码**决定是否 CI 红）。
- **影响**：命令删除 → release 脚本降级（`|| true` 兜底）但 CI 治理步直接失败。**破坏性**（CI 路径）。

### 1.3 `npx harness sync-docs` — 破坏性
- **位置**：`scripts/release.ts:49`。
- **影响**：release 流程文档同步失效。**破坏性**。

### 1.4 `npx harness sync-docs --agents` — 破坏性
- **位置**：
  - 根 `package.json:46` `agents-md:sync`：`npx harness sync-docs --agents && node scripts/gen-agents-md.mjs`。
  - `.github/workflows/ci.yml:27`。
- **契约**：生成根 `AGENTS.md`，必须**保留** `<!-- PRESERVE:名称 --> ... <!-- /PRESERVE:名称 -->` 块（见 §4.1）。`scripts/gen-agents-md.mjs:13-15,98-101` 明确依赖「PRESERVE 包裹后 harness 原样穿过、--check 不误判 stale」的语义。
- **影响**：`--agents` 标志删除、或 PRESERVE 语义变化 → AGENTS.md 手写区丢失 / CI 漂移误报。**破坏性**。

### 1.5 `npx harness sync-docs --check --agents` — 破坏性
- **位置**：`.github/workflows/ci.yml:27`（漂移校验，依赖退出码）。
- **契约**：`--check` 模式比对「现有 AGENTS.md」与「应生成内容」，不一致则非零退出。gen-agents-md.mjs 依赖它对 PRESERVE 块免疫。
- **影响**：删除/语义变化 → CI 治理步失败或误报。**破坏性**。

### 1.6 `npx harness constraints --json` — 破坏性
- **位置**：`packages/studio-agent/src/services/output-capture.ts:220`。
- **输出契约**：JSON 需含 `hash`（约束哈希）与 `textSize.total`（数值）。代码有 `|| node -e "...unknown"` 兜底，但兜底只防命令不存在，**不防 JSON 结构变化**。
- **影响**：命令删除或 JSON 字段改名 → `getConstraintMeta()` 拿到 unknown/0，执行记录的约束 metadata 失真。**破坏性**（字段级）。

### 1.7 `npx harness update-user-model --days N --json` — 可适配
- **位置**：`apps/api/src/modules/agents/monitor-system-probes.ts:196`（`--days 1 --json 2>/dev/null || echo "{}"`）。
- **输出契约**：JSON 含 `newSessions`、`changes[]`。
- **影响**：整段在 try/catch 里且标 non-blocking；删除只影响每日用户模型更新，不阻断主流程。**可适配**。

### 1.8 `npx harness <任意子命令>` 透传 — 可适配
- **位置**：`apps/api/src/cli/data.ts:91-95`（`studioHarnessCli`：`execSync(\`npx harness ${args.join(' ')}\`)`），经 `apps/api/src/cli/studio-cli.ts:96`（`case 'harness'`）与帮助文本 `studio-cli.ts:131`（`studio harness <check>`）暴露为 `studio harness <sub>`。
- **影响**：透传本身不绑定具体子命令；但用户/文档默认 `studio harness check` 可用。**可适配**（取决于保留哪些子命令）。

### 1.9 仅文档/规划提及、代码未实际调用的 CLI — 无影响（记录）
以下出现在 `docs/`、`.prompt.md`、`.progress.json`、`docs/roadmap.md`，但 studio 源码里没有 `execSync`/`execFile` 调用（多为历史规划或降级记录）：
- `harness knowledge audit [--fix] [--dir]`、`harness knowledge index`、`harness knowledge health`、`harness knowledge patterns`。
- 注：`.progress.json:47` 明确记录「`harness knowledge index` CLI 无此子命令，需手动用 python 生成」——说明该命令可能从未存在或已移除。
- **影响**：删除这些（若存在）不影响 studio 代码；但若未来 studio 按文档启用需另行评估。**无影响**。

### 1.10 `scripts/tools/harness-coverage.ts`（`pnpm harness:coverage`）— 无影响
- **位置**：`scripts/tools/harness-coverage.ts`。
- **说明**：**不 import `@dommaker/harness`**，只扫描 studio 自有 `packages/studio-shared/src/harness/hooks/*.hooks.ts` 与调用点，生成热力图。与 harness 包无运行时耦合。**无影响**。

---

## 2. API import（按功能域）

> 约定：每条给 studio 侧文件:行号、用到的符号、影响级别。「类型」指仅 `import type`（删除只影响 TS 编译，不影响运行时，但会阻断 studio 构建，统一按破坏性计，除非有降级）。

### 2.1 约束引擎（三层约束 + 检查）— 破坏性
| studio 文件:行号 | 符号 | 用法 |
|---|---|---|
| `packages/studio-shared/src/harness/index.ts:8-36` | `constraintChecker`, `getAllConstraints`, `getConstraint`, `checkConstraint`, `IRON_LAWS`, `GUIDELINES`, `TIPS` + 类型 `Constraint`,`ConstraintResult`,`ConstraintContext`,`ConstraintCheckResult` | ConstraintService/IronLawService 核心；`IRON_LAWS/GUIDELINES/TIPS` 是 `Record<string,Constraint>` |
| `packages/studio-shared/src/harness/prompt-injection.ts:8-9` | `getAllConstraints`, 类型 `ConstraintTrigger` | 按 role 过滤约束并注入 prompt；读 `c.trigger`(可数组)、`c.level`、`c.id`、`c.promptInjection` |
| `apps/api/src/modules/harness/constraints.routes.ts:182-189` | `harnessModule.checkConstraints(ctx)` | M2 质量门，非抛出式；注释明确 `checkConstraintsSafe` 已在 harness 0.13.0 移除 |
| `apps/api/src/modules/admin/docs-freshness.routes.ts:12,39-51` | `checkConstraints({operation:'module_modification', projectPath})` | 读返回的 `guidelines[]`/`ironLaws[]`，按 `r.id`∈{`docs_freshness`,`capability_sync`}、`r.satisfied`、`r.message` 过滤 |
| `apps/api/tests/harness-integration.test.ts:7` | `checkConstraints`, `ConstraintViolationError` | 集成测试断言抛出 |
| `apps/api/src/modules/evolution/applier.ts:24`、`generator.ts:23-30` | `GUIDELINES`, `IRON_LAWS`, `TIPS` | 进化时查找内置约束定义 |
| `packages/studio-shared/src/node.ts:20`、`packages/studio-shared/src/index.ts:38` | 类型 `ConstraintLevel`,`ConstraintContext`,`ConstraintResult` | 对外 re-export |
| `apps/api/src/modules/harness/iron-laws.routes.ts:4` | 类型 `IronLawContext` | 经 studio-shared `ironLawService` |

**影响**：约束引擎是 studio 治理/门禁/prompt 注入的地基。删除 `checkConstraints`/`getAllConstraints`/`IRON_LAWS` 等 → ConstraintService、prompt 注入、M2 门、docs-freshness、iron-laws API 全崩。**破坏性**。
**注意**：`checkConstraints` 返回结构需含 `guidelines`/`ironLaws` 数组且元素有 `id`/`satisfied`/`message`（docs-freshness 依赖）。约束对象需含 `id`/`level`/`trigger`/`promptInjection`/`message`/`rule`（prompt-injection、constraints.routes 依赖）。

### 2.2 TraceCollector / 检查点门禁 / 失败记录 — 破坏性
| studio 文件:行号 | 符号 |
|---|---|
| `packages/studio-shared/src/harness/index.ts:16` | `CheckpointValidator`（`.getInstance()`、`.validate(checkpoint, ctx)`、`.getSupportedCheckTypes()`） |
| `packages/studio-spec/src/services/gate-checker.service.ts:37-38,170-227` | 动态 `import('@dommaker/harness').CheckpointValidator.getInstance()`；`validator.validate(checkpoint, context)` 返回 `{passed, message}` |
| `packages/studio-shared/src/harness/hooks/completion.hooks.ts:7-8` | `PassesGate`, `getTraceCollector`, `createFailureRecorder`, `ErrorType`, `FailureLevel`, 类型 `TestResult` |
| `packages/studio-shared/src/harness/hooks/goal.hooks.ts:7-8`、`agent.hooks.ts:7-8` | `checkBeforeExecution`, `getTraceCollector`, 类型 `ConstraintContext` |
| `apps/api/src/modules/harness/diagnostics.routes.ts:36,61-71` | `ErrorClassifier`, `FailureRecorder({logFile})`, 类型 `FailureRecord` |
| `apps/api/tests/review-gate.test.ts:8-9` | `ReviewGate`, 类型 `GateContext`,`GateResult`（vi.mock） |

- `getTraceCollector()` 返回对象需有 `recordPass/recordFail/recordBypass`（agent.hooks、completion.hooks、traces.routes 调用）。
- `createFailureRecorder({logFile})` 写 `.harness/logs/failures.log`。
- gate-checker 用 `?.getInstance?.()` + try/catch，**有一定降级**，但 `CheckpointValidator`、`PassesGate`、`checkBeforeExecution` 在 hooks 主链路上是硬依赖。
**影响**：**破坏性**（hooks/门禁/检查点主链路）。gate-checker 单点可适配。

### 2.3 Hooks 管线 / Bootstrap — 破坏性
| studio 文件:行号 | 符号 |
|---|---|
| `packages/studio-shared/src/harness/runtime/bootstrap.ts:8-9,35` | `bootstrapHarness`(async)、`bootstrapHarnessSync`、`HookRegistry`、`HookPipeline`、类型 `HarnessBootstrap`,`HookDefinition` |
| `packages/studio-shared/src/harness/hooks/register.ts:8,24-67` | 类型 `HookRegistry`,`HookDefinition`；`registry.registerAll(hookDefs)` |
| `apps/api/src/index.ts:66-67` | 启动时 `await bootstrapHarness()` |

- `bootstrapHarness(root)` 返回 `HarnessBootstrap`，需有 `.hooks`（HookRegistry，`.size`）、`.pipeline`（HookPipeline）。
- `HookDefinition` 形如 `{name, phase:'before'|'after', enabled, errorStrategy:'block'|'warn', execute}`；`registry.registerAll([...])`。
**影响**：API 服务启动即调用 bootstrap；删除/签名变化 → 服务启动失败或 hooks 全失效。**破坏性**。

### 2.4 知识引擎（最大使用面）— 破坏性
| studio 文件:行号 | 符号与方法 |
|---|---|
| `apps/api/src/modules/knowledge/knowledge-singletons.ts:18-19` | `FileKnowledgeStore`, `KnowledgeIngest`, `KnowledgeLifecycle`, `KnowledgeQuery`, `KnowledgeInjector`, `KnowledgeLinter`, `ReferenceTracker` + 类型 `KnowledgeEntry`,`KnowledgeSubsystem`,`MaturityLevel` |
| `apps/api/src/modules/knowledge/knowledge-service.ts:19-28` | 类型 `KnowledgeEntry`,`KnowledgeStore`,`KnowledgeIngest`,`KnowledgeLifecycle`,`KnowledgeLinter`,`QueryFilter`,`MaturityLevel`,`KnowledgeSubsystem` |
| `apps/api/src/modules/knowledge/engine/unified-query.ts:10-12` | `FileKnowledgeStore` + 类型 `KnowledgeStore`,`KnowledgeEntry`,`QueryFilter` |
| `apps/api/src/modules/knowledge/knowledge-bus.service.ts:30-31` | 类型 `KnowledgeStore`,`KnowledgeIngest`,`KnowledgeSubsystem`,`DecisionRecord` |
| `apps/api/src/modules/knowledge/decision-chain-extractor.ts:12` | 类型 `KnowledgeEntry` |
| `apps/api/src/modules/knowledge/evolution.service.ts:17` | 类型 `MaturityLevel` |
| `apps/api/src/modules/agents/monitor-system-probes.ts:19,112-114` | `KnowledgeLinter`, `KnowledgeHealthScorer`, `ReferenceTracker` |
| `apps/api/src/modules/agents/knowledge-cold-start.ts:9,36-58` | `ColdStartImporter` |
| `apps/api/src/modules/agents/monitor-reports.ts:306,334` | `KnowledgeAudit`, `FileKnowledgeStore`（`as any` 动态 import） |
| `apps/api/src/modules/harness/runtime.ts:84-85` | `FileKnowledgeStore({baseDir})`, `KnowledgeQuery(store)` |

**依赖的具体实例方法/构造签名**（重构时签名必须兼容或 studio 全改）：
- `FileKnowledgeStore({baseDir})`：`.list(filter?)`、`.get(id)`、`.save(entry)`、`.delete(id)`、`.update(id, partial)`、`.snapshot()`；knowledge-singletons 以 `{baseDir: ~/.studio/knowledge}` 构造。
- `KnowledgeLifecycle(store, {autoPromoteSources:[...]})`：`.recordReference(id, source[, success, mode])`、`.tryPromote(id)`、`.runDecayCycle()`、`.shouldAutoPromote(source)`、`.onReference(cb)`（**harness ≥0.13.4**，knowledge-singletons.ts:60-75 有版本检查日志）、`.checkSkillCandidateRevocation(id)`（knowledge-service.ts:1133，**可选方法**，studio 用 `if (lifecycle.checkSkillCandidateRevocation)` 探测）。
- `KnowledgeIngest(store)`：`.ingestEntry(entry, opts)`，返回保存条目；**被拒时返回带 `__rejected`/`__rejectReasons` 标记的对象**（knowledge-singletons.ts:272-278 依赖此内置 KnowledgeAudit 门禁语义）。
- `KnowledgeQuery(store[, lifecycle])`：`.query(budget, filter)`、`.queryByMode`、`.consume`。
- `KnowledgeInjector(query)`。
- `KnowledgeLinter(store, tracker)`：`.run(autoFix?)`→`{issues, fixed}`、`.validateEntry({title,content,tags,type})`。
- `ReferenceTracker(store)`。
- `KnowledgeHealthScorer(store, linter)`。
- `KnowledgeAudit({baseDir})`：`.run({autoFix})`→`{totalEntries, healthScore:{before,after}, autoFixed, dimensions, issues[]}`（monitor-reports.ts:306-329 读这些字段）。
- `ColdStartImporter({projectRoot, store, sources, docPaths, manualEntries, skipExisting})`：`.importAll()`→`[{source:{type}, entries, errors}]`。

**影响**：知识引擎是 studio 知识库（`~/.studio/knowledge`）的唯一存储与生命周期实现。任一构造器/方法签名变化或删除 → 知识写入、查询、晋升、衰减、审计、冷启动全崩。**破坏性**（最高优先级护栏）。
**可适配点**：`KnowledgeAudit`/`FileKnowledgeStore.snapshot` 在 monitor-reports 里用 `as any` + try/catch（best-effort）；`checkSkillCandidateRevocation` 是可选探测。

### 2.5 Trace 分析 / 进化 / 约束生命周期 — 破坏性
| studio 文件:行号 | 符号与方法 |
|---|---|
| `apps/api/src/modules/harness/runtime.ts:60-70` | `TraceCollector()`、`TraceAnalyzer(collector)` |
| `apps/api/src/modules/harness/traces.routes.ts:14,38-151` | 类型 `ExecutionTrace`,`TraceFilter`；`collector.read(filter)`、`.recordPass/.recordFail/.recordBypass`、`analyzer.analyzeRecent(h)`、`.detectAnomalies(summaries)`、`ConstraintDoctor({enabled})`（`.setData(traces)`、`.diagnose(anomaly)`） |
| `apps/api/src/modules/harness/proposals.routes.ts:111,82,186` | `autoEvolve(traces, anomalies, {autoApproveLowRisk})`→`{proposals,diagnoses,autoApproved,needsReview,executions}`；`ConstraintLifecycleRunner()`（`.execute(proposal)`→`{success}`） |
| `apps/api/src/modules/harness/constraints.routes.ts:29-160` | `ConstraintRegistry()`：`.getAll()`、`.getLayerStats()`、`.get(id)`、`.degrade(id)`、`.rollback(id, originalLevel)`、`.scheduleDeprecation(id, opts)`；约束对象字段 `id,level,layer,deprecationStatus,permanent,trigger,rule,message` |
| `apps/api/src/modules/evolution/generator.ts:23-30` | `autoEvolve`, `TraceAnalyzer`, `TraceCollector`, `GUIDELINES`,`IRON_LAWS`,`TIPS` |
| `apps/api/src/modules/evolution/signals.ts:14` | 类型 `ExecutionTrace`；读 `.harness/logs/traces.log`（见 §4.5） |

**影响**：harness 监控 API（`/api/v1/harness/*`）与 E1 约束进化的核心。**破坏性**。
**可适配点**：所有 harness module 路由经 `runtime.ts` 懒加载，harness 不可用时返回 503（有降级），但功能整体失效。

### 2.6 安全护栏 / 沙箱 / 上下文 / Token — 破坏性
| studio 文件:行号 | 符号与方法 |
|---|---|
| `packages/studio-shared/src/harness/index.ts:22-28` | `InputGuardrail`, `OutputGuardrail`, `ToolGuardrail`, `Sandbox`, `TokenBudget`, `SessionCompaction`, `AgentLifecycle` |
| `apps/api/src/modules/harness/guards.routes.ts:31-82` | `InputGuardrail().check(input)`、`OutputGuardrail().check(output)`、`Sandbox()`（`.getLevel()`、`.getDescription()`、`.needsConfirmation()`） |
| `apps/api/src/modules/harness/sessions.routes.ts:33-146` | `TokenEstimator.estimateText/.estimateObject`、`SessionManager()`（`.createSession`、`.appendToSession`、`.getSessionInfo`、`.checkpointSession`） |

**影响**：安全护栏与上下文管理 API 的直接实现。**破坏性**（经懒加载降级为 503，但功能失效）。

### 2.7 Agent 生命周期 — 破坏性
- `apps/api/src/modules/harness/agents.routes.ts:17,31-137`：`AgentLifecycle()`，方法 `.register({id,type,name,capabilities,...})`、`.start(id)`、`.complete(id, metadata)`、`.fail(id, err)`、`.getAllStates()`、`.getState(id)`。
- 也在 `packages/studio-shared/src/harness/index.ts:28` import。
**影响**：agent 生命周期 API。**破坏性**。

### 2.8 Spec 注解检查 — 破坏性
| studio 文件:行号 | 符号 |
|---|---|
| `apps/api/src/modules/harness/diagnostics.routes.ts:98-103` | `checkFile(path)`、`checkDirectory(path)`、`generateReport(results)` |
| `scripts/tools/spec-gate.ts:25-27,135-166` | `checkDirectory`, `generateReport`（`checkDirectory('src',{extensions})` 返回含 `.errors[]`/`.warnings[]` 的结果数组） |

**影响**：spec 门禁与诊断 API。**破坏性**。

### 2.9 架构 / 跨工程检查 — 破坏性
| studio 文件:行号 | 符号 |
|---|---|
| `scripts/tools/architect-check.ts:15` | `runArchitectureCheck(configPath, ctx)`, 类型 `ArchitectureContext`；读 `result.violations[]`(`severity`,`ruleId`,`message`,`files`)、`result.passed` |
| `scripts/tools/spec-gate.ts:14-23` | `ArchitectureConstraintEngine`, `loadArchitectureRules`, `ArchitectureContext`, `checkCrossProjectContracts`, `checkDocCodeConsistency`, `CrossProjectContext` |
| `scripts/tools/cross-project-check.ts:15-19` | `checkCrossProjectContracts`, `checkDocCodeConsistency`, `CrossProjectContext`；读 violation 的 `type,fromProject,toProject,message,severity,details.interfaceName` |

**影响**：架构/跨工程门禁脚本。**破坏性**。

### 2.10 错误分类 / 规则验证 — 破坏性
- `apps/api/src/modules/harness/diagnostics.routes.ts:36-38,137-144`：`ErrorClassifier()`（`.classify(err)`、`.getLevel(type)`）、`RulesBasedVerification(rules)`（`.verifyAll(ctx)`）。
**影响**：**破坏性**。

### 2.11 仪表盘 / CSO — 可适配
- `apps/api/src/modules/harness/dashboard.routes.ts:27`：`DashboardDataProvider()`（`.generate(entries)`）。
- `apps/api/src/modules/harness/cso.routes.ts:23`：`CSOValidator?.getInstance?.()`，**已用可选链 + 降级**（无则返回 `valid:true`）。
**影响**：dashboard 破坏性（功能失效）；CSO 已降级，**可适配**。

### 2.12 路径 / 能力注册 — 破坏性
- `apps/api/src/modules/capabilities/routes.ts:5`：`getRegistryPath()`, `getToolsDir()`。
- `packages/studio-capability/src/services/capability.service.ts:12`：`getRegistryPath()`。
**影响**：能力注册表路径解析。**破坏性**（除非 studio 改为自带路径）。

---

## 3. 包内文件 / 布局依赖（harness npm 包的物理结构）

> 这些不是 API import，而是直接读 harness 包内的文件/字段。**重构 harness 包结构时必须保持或提供等价物**。

| studio 文件:行号 | 依赖 | 影响 |
|---|---|---|
| `scripts/harness-sync.js:13-14` | `node_modules/@dommaker/harness/package.json` 的 `version` 字段 | **破坏性**（postinstall 版本比对） |
| `apps/api/src/modules/knowledge/env-snapper.ts:217-223` | 同上（读 `version` 写入环境快照，try/catch 降级为 `unknown`） | 可适配 |
| `scripts/harness-upgrade.ts:169-179` | `require('@dommaker/harness')` + `Object.keys(m)` 内省导出，用于升级时检测被删 API | **破坏性**（依赖 **CJS require 可用** + 具名导出稳定；见 §5.3） |
| `packages/studio-agent/src/services/worktree-resolver.ts:185-192` | `require.resolve('@dommaker/harness/package.json')` 定位包根，再拷 `templates/node-api/.harness` 到 worktree | **破坏性**（依赖包内 `templates/node-api/.harness` 目录存在） |
| `apps/api/src/modules/knowledge/rule-scanner.ts:196-222` | 读包内 `src/core/constraints/definitions.ts`，用正则 `{\s*key:\s*'(\w+)'...description:\s*'([^']+)'` 提取约束 | **破坏性**（依赖包内 `src/core/constraints/definitions.ts` 存在且含 `key:`/`description:` 字面量；文件不存在时仅 debug 降级） |

**包导出结构**（node_modules/@dommaker/harness/package.json 实测）：`exports` 含 `.`、`./core`、`./presets`、`./context`；`bin.harness`；`files` 含 `dist`,`bin`,`src`,`templates`。studio 当前**只 import 根入口**（`.`），未用 `./core`/`./presets`/`./context` 子路径——但 CJS `require()` 与 `files` 里的 `src`/`templates` 被上表依赖。

---

## 4. 生成物契约（harness 生成的文件，studio 会解析或重新生成）

### 4.1 `AGENTS.md` + PRESERVE 机制 — 破坏性
- 生成方：`harness sync-docs --agents`（见 AGENTS.md:3 头部声明）。
- studio 依赖方：
  - `scripts/gen-agents-md.mjs:13-15,98-101,116-124`：在 harness 骨架内维护 `<!-- AUTO-GENERATED:modules -->` 段，**外层套 `<!-- PRESERVE:modules -->`**，依赖「harness 漂移比对不认识本区段、套入后原样穿过、`--check` 不误判 stale」的语义。
  - `.github/workflows/ci.yml:23-27`：注释记录历史教训——旧版 sync-docs 曾把知识库条数写进 AGENTS.md 导致测试抖动误报，**0.16.6 起条数已移除**；治理步要求 `check && sync-docs --agents && sync-docs --check --agents` 串行。
- **契约**：PRESERVE 块必须被原样保留；`--check` 必须对 PRESERVE 内容免疫；不得再往 AGENTS.md 写动态条数。
**影响**：**破坏性**（CI + AGENTS.md 生成链）。

### 4.2 `CLAUDE.md` 的 HARNESS_CONSTRAINTS 标记块 — 破坏性
- `harness init` 在 CLAUDE.md 写「Governance Rules」块，边界为 `<!-- HARNESS_CONSTRAINTS_START -->` / `<!-- HARNESS_CONSTRAINTS_END -->`（实测 CLAUDE.md:13,58；CACHE_PREFIX.md:17,66 同）。
- studio 依赖方：`packages/studio-shared/src/harness/hooks/agent.hooks.ts:49-50` 检测 `<!-- HARNESS_CONSTRAINTS_START -->` 存在则只注入短引用（去重）；`worktree-resolver.ts:162-171` 复制 CLAUDE.md 到 worktree 使该去重生效。
- CLAUDE.md:63 明确「HARNESS_CONSTRAINTS 标记段之外的内容 `harness init` 不会覆盖」。
**契约**：init 只覆写标记块内、保留块外；标记字符串不能变。
**影响**：**破坏性**（标记改名/覆写行为变化 → prompt 去重失效或手写内容被覆盖）。

### 4.3 `CONTEXT.md` 骨架模板 — 破坏性
- 生成方：`harness sync-docs`（fill-context-docs.ts:5 注释）。
- studio 依赖方：`scripts/fill-context-docs.ts:38-49` 硬编码识别 harness 模板的：
  - 占位行集合（`本目录的核心职责是？` 等 4 行，HARNESS_PLACEHOLDER_LINES）；
  - STALE 标记正则 `<!--\s*STALE_SINCE:...-->`、警告行 `⚠️ 以下文件已变更...`、模板注释正则；
  - 受管小节名 `['职责','核心导出','依赖关系','注意事项']`（MANAGED_SECTIONS）；
  - 填充状态写 `.harness/context-fill-state.json`（DEFAULT_STATE_PATH）。
- `scripts/gen-agents-md.mjs:28-53` 也从 CONTEXT.md 提取「## 职责」小节做模块索引摘要。
**契约**：模板占位行文案、小节名、STALE 标记格式。
**影响**：**破坏性**（模板文案变化 → fill-context-docs 无法识别占位，LLM 填充/去垃圾逻辑失效）。

### 4.4 `.harness/config.yml` — 破坏性
- studio 依赖方：`scripts/harness-sync.js:20-29`（正则提取 `version:`）；`packages/studio-shared/src/harness/runtime/bootstrap.ts:5`（启动加载）；实测内容含 `preset`、`enabled`、`ironLaws`、`validators`、`harness.version`。
- `.gitignore:51` 有 `!**/.harness/config.yml`（白名单保留）。
**影响**：**破坏性**（version 行格式、config 结构）。

### 4.5 `.harness/logs/traces.log`（ExecutionTrace JSONL）— 破坏性
- 写入方：harness `TraceCollector`；读取方：`apps/api/src/modules/evolution/signals.ts:5,39`（`traceFile = <repoRoot>/.harness/logs/traces.log`，作为 autoEvolve 输入）。
**契约**：文件路径 + ExecutionTrace JSONL 行格式。
**影响**：**破坏性**（路径/格式变化 → E1 进化信号断供）。

### 4.6 其他 `.harness/` 子目录 — 可适配/破坏性混合
- `.harness/checkpoints.yml`、`custom-constraints.yml`：`worktree-resolver.ts:178` 复制这两个文件到 worktree；`evolution/applier.ts:8` 写 `.harness/custom-constraints.yml`（依赖 harness ProjectConfigLoader 按 id mergeConstraints 覆盖内置、支持 extend-only 条目）。**破坏性**（applier 写入语义依赖 loader 合并规则）。
- `.harness/logs/failures.log`：`completion.hooks.ts:49`、`diagnostics.routes.ts:62` 作为 FailureRecorder logFile。**可适配**（路径是 studio 传入的）。
- `.harness/proposals/*.json`：`proposals.routes.ts:29,67` 直接读写（studio 自管，非 harness 生成）。**无影响**（studio 自有）。
- `.harness/knowledge/` 与 `~/.studio/knowledge/`：知识库目录，含 `index.json`、`_index.md`、`.archive/`。`scripts/cleanup-runtime-data.ts:236-245` 清理 `.harness/knowledge` 测试污染（含 index.json 条目）。**破坏性**（存储布局，见 §2.4 FileKnowledgeStore）。

### 4.7 `CAPABILITIES.md` — 可适配
- README.md:207 标注「harness sync-docs 自动维护」；docs-freshness 用 `capability_sync` 约束检查它（§2.1）。
**影响**：sync-docs 能力的一部分；随 §1.3/1.4 走。

---

## 5. 隐式依赖（CI / hooks / 构建 / 升级流程）

### 5.1 CI 治理步 — 破坏性
- `.github/workflows/ci.yml:26-27`：`npx harness check && npx harness sync-docs --agents && npx harness sync-docs --check --agents`。三条命令的**存在性、退出码语义、顺序**都是硬约束。

### 5.2 postinstall / prepare 自动 init — 破坏性
- 根 `package.json`：`postinstall` 与 `prepare` 均 `node scripts/harness-sync.js`。任何 `pnpm install/update/add` 都触发版本比对 → 条件 `init`。harness 必须保证 `init` 幂等、可离线运行。

### 5.3 CJS/ESM 双模 + 具名导出稳定性 — 破坏性
- `scripts/harness-upgrade.ts:172` 用 `require('@dommaker/harness')` + `Object.keys(m)` 做升级期 breaking-change 检测。要求：根入口 **CJS require 可用**，且具名导出可枚举。
- `apps/api/src/modules/harness/runtime.ts:29` 用 ESM `import('@dommaker/harness')` 懒加载。要求：ESM import 可用。
- harness package.json 当前对 `.` 同时给 `require`/`import` 指向 `dist/index.js`。**重构若改纯 ESM 或改 exports，会破坏 upgrade 脚本的 require 与内省**。

### 5.4 版本耦合点 — 破坏性
- `knowledge-singletons.ts:60-75` 显式依赖 `KnowledgeLifecycle.onReference`（harness ≥0.13.4），缺失会打 error 日志并使消费事件链失效。
- `constraints.routes.ts:182` 注释记录 `checkConstraintsSafe` 已在 0.13.0 移除——studio 已跟随过 harness 的破坏性改名，说明**改名会真实波及 studio**。

### 5.5 studio CLI 透传 — 可适配
- `studio harness <sub>`（§1.8）。保留哪些子命令决定透传可用面。

### 5.6 文档约定（真实需要但代码未显式引入的候选）— 无影响（记录）
- `harness knowledge audit/index/health/patterns`（§1.9）：docs/.prompt.md 多处引用为「应该用」的工具，但 studio 代码未实际 execSync 调用。属于**潜在未来需求**，非当前护栏。

---

## 6. 护栏清单（harness 重构时不可删除 / 不可破坏性变更）

> 分级：**P0 = 删除/改名即破坏 studio 生产路径，必须保留或提供同步迁移**；**P1 = 有降级但功能整体失效，强烈建议保留**；**P2 = 可适配，改动需通知 studio**。

### P0 — CLI
1. `harness init`（幂等；postinstall/prepare 自动调用）
2. `harness check`（CI 依赖退出码）
3. `harness sync-docs`（含 `--agents`、`--check`、`--check --agents`；PRESERVE 块语义；`--check` 对 PRESERVE 免疫；不写动态条数）
4. `harness constraints --json`（输出 `{hash, textSize.total}`）

### P0 — 包结构 / 入口
5. 根入口同时支持 **CJS `require()` 与 ESM `import()`**，具名导出可枚举（upgrade 脚本内省）
6. `package.json` 含 `version` 字段（harness-sync / env-snapper 读取）
7. 包内 `templates/node-api/.harness/` 目录（worktree-resolver 拷贝）
8. 包内 `src/core/constraints/definitions.ts`，含 `key:`/`description:` 字面量（rule-scanner 正则解析）
9. `.harness/config.yml` 的 `version:` 行格式（harness-sync 正则）

### P0 — 约束引擎 API
10. `IRON_LAWS` / `GUIDELINES` / `TIPS`（`Record<string, Constraint>`）
11. `getAllConstraints()` / `getConstraint(id)` / `checkConstraint(id, ctx)` / `constraintChecker.checkConstraints(ctx)` / `checkConstraints(ctx)`（返回含 `guidelines[]`/`ironLaws[]`，元素有 `id`/`satisfied`/`message`）
12. `checkBeforeExecution(ctx)`
13. `getTraceCollector()` → `.recordPass/.recordFail/.recordBypass`
14. 约束对象字段：`id`/`level`/`trigger`(可数组)/`promptInjection`/`message`/`rule`
15. 约束 id `docs_freshness`、`capability_sync` 与 operation `module_modification`（docs-freshness 依赖）

### P0 — 知识引擎 API（最大面）
16. `FileKnowledgeStore({baseDir})` + `.list/.get/.save/.delete/.update/.snapshot`
17. `KnowledgeLifecycle(store, {autoPromoteSources})` + `.recordReference/.tryPromote/.runDecayCycle/.shouldAutoPromote/.onReference`（≥0.13.4）/`.checkSkillCandidateRevocation`（可选）
18. `KnowledgeIngest(store)` + `.ingestEntry()`（拒绝时返回 `__rejected`/`__rejectReasons`）
19. `KnowledgeQuery(store[, lifecycle])` + `.query/.queryByMode/.consume`
20. `KnowledgeInjector(query)`
21. `KnowledgeLinter(store, tracker)` + `.run(autoFix?)`→`{issues,fixed}` / `.validateEntry()`
22. `ReferenceTracker(store)`、`KnowledgeHealthScorer(store, linter)`
23. `KnowledgeAudit({baseDir})` + `.run({autoFix})`→`{totalEntries, healthScore, autoFixed, dimensions, issues}`
24. `ColdStartImporter({...})` + `.importAll()`
25. 类型：`KnowledgeEntry`/`KnowledgeStore`/`KnowledgeSubsystem`/`MaturityLevel`/`QueryFilter`/`DecisionRecord`
26. 知识库磁盘布局：`index.json`、`_index.md`、`.archive/`（cleanup-runtime-data、monitor 依赖）

### P0 — Hooks / Bootstrap
27. `bootstrapHarness(root)`(async) / `bootstrapHarnessSync(root)` → `HarnessBootstrap{hooks:HookRegistry, pipeline:HookPipeline}`
28. `HookRegistry.registerAll(defs)` / `.size`；`HookDefinition{name, phase, enabled, errorStrategy, execute}`

### P0 — 检查点 / 门禁 / 失败记录
29. `CheckpointValidator.getInstance()` + `.validate(checkpoint, ctx)`→`{passed,message}` + `.getSupportedCheckTypes()`
30. `PassesGate` + `.check()`→`{allowed, violations}`
31. `createFailureRecorder({logFile})` / `FailureRecorder`；`ErrorType`/`FailureLevel`/`TestResult`/`FailureRecord`

### P0 — 生成物契约
32. `AGENTS.md` PRESERVE 块机制（`<!-- PRESERVE:name -->`）
33. `CLAUDE.md` `<!-- HARNESS_CONSTRAINTS_START/END -->` 标记块（init 只覆写块内）
34. `CONTEXT.md` 模板：占位行文案、受管小节（职责/核心导出/依赖关系/注意事项）、STALE_SINCE 标记
35. `.harness/logs/traces.log` ExecutionTrace JSONL 格式与路径（evolution/signals 读取）
36. `.harness/custom-constraints.yml` 合并语义（ProjectConfigLoader 按 id 覆盖内置 + extend-only 条目）

### P1 — harness 监控/进化/护栏 API（经懒加载降级为 503，但功能失效）
37. `TraceCollector`/`TraceAnalyzer`（`.read/.analyzeRecent/.detectAnomalies`）、`autoEvolve()`、`ConstraintDoctor`、`ConstraintLifecycleRunner`、`ConstraintRegistry`（`.getAll/.getLayerStats/.get/.degrade/.rollback/.scheduleDeprecation`）
38. `InputGuardrail`/`OutputGuardrail`/`ToolGuardrail`/`Sandbox`（`.getLevel/.getDescription/.needsConfirmation`）、`TokenBudget`、`SessionCompaction`
39. `TokenEstimator.estimateText/.estimateObject`、`SessionManager`（`.createSession/.appendToSession/.getSessionInfo/.checkpointSession`）
40. `AgentLifecycle`（`.register/.start/.complete/.fail/.getAllStates/.getState`）
41. `DashboardDataProvider.generate(entries)`
42. `ErrorClassifier`（`.classify/.getLevel`）、`RulesBasedVerification.verifyAll`
43. `checkFile`/`checkDirectory`/`generateReport`（spec 注解检查）
44. `runArchitectureCheck`/`ArchitectureConstraintEngine`/`loadArchitectureRules`/`checkCrossProjectContracts`/`checkDocCodeConsistency` + `ArchitectureContext`/`CrossProjectContext`
45. `getRegistryPath()`/`getToolsDir()`
46. 类型：`Constraint`/`ConstraintResult`/`ConstraintContext`/`ConstraintCheckResult`/`ConstraintLevel`/`ConstraintTrigger`/`Checkpoint`/`CheckpointResult`/`CheckpointContext`/`GateContext`/`GateResult`/`ExecutionTrace`/`TraceFilter`/`IronLawContext`/`HarnessBootstrap`/`HookRegistry`/`HookPipeline`/`AgentLifecycle`

### P2 — 可适配 / 已降级
47. `harness update-user-model --days N --json`（monitor，non-blocking）
48. `CSOValidator.getInstance()`（已用可选链降级）
49. `ReviewGate`（测试中 mock）
50. `studio harness <sub>` 透传（可用面随保留的子命令变化）

### 明确无影响（可自由处置）
- `scripts/tools/harness-coverage.ts`（不 import harness 包，仅扫 studio 自有 hooks）
- `apps/api/src/modules/harness/proposals.routes.ts` 的 `.harness/proposals/*.json`（studio 自管文件）
- `harness knowledge audit/index/health/patterns` CLI（studio 代码未实际调用，仅文档提及）
- studio 自有 `packages/studio-shared/src/harness/` 桥接层本身（是 studio 代码，非 harness 包内容，重构 harness 不直接触碰，但其 import 的符号受上表约束）

---

## 附：studio 侧 import 符号全量清单（去重）

**值导入**：`IRON_LAWS`, `GUIDELINES`, `TIPS`, `constraintChecker`, `getAllConstraints`, `getConstraint`, `checkConstraint`, `checkConstraints`, `checkBeforeExecution`, `getTraceCollector`, `CheckpointValidator`, `PassesGate`, `createFailureRecorder`, `FailureRecorder`, `ErrorClassifier`, `RulesBasedVerification`, `bootstrapHarness`, `bootstrapHarnessSync`, `HookRegistry`, `HookPipeline`, `FileKnowledgeStore`, `KnowledgeLifecycle`, `KnowledgeIngest`, `KnowledgeQuery`, `KnowledgeInjector`, `KnowledgeLinter`, `ReferenceTracker`, `KnowledgeHealthScorer`, `KnowledgeAudit`, `ColdStartImporter`, `TraceCollector`, `TraceAnalyzer`, `autoEvolve`, `ConstraintDoctor`, `ConstraintLifecycleRunner`, `ConstraintRegistry`, `InputGuardrail`, `OutputGuardrail`, `ToolGuardrail`, `Sandbox`, `TokenBudget`, `SessionCompaction`, `AgentLifecycle`, `TokenEstimator`, `SessionManager`, `DashboardDataProvider`, `CSOValidator`, `ReviewGate`, `ErrorType`, `FailureLevel`, `checkFile`, `checkDirectory`, `generateReport`, `runArchitectureCheck`, `ArchitectureConstraintEngine`, `loadArchitectureRules`, `checkCrossProjectContracts`, `checkDocCodeConsistency`, `getRegistryPath`, `getToolsDir`, `ConstraintViolationError`

**类型导入**：`Constraint`, `ConstraintResult`, `ConstraintContext`, `ConstraintCheckResult`, `ConstraintLevel`, `ConstraintTrigger`, `Checkpoint`, `CheckpointResult`, `CheckpointContext`, `GateContext`, `GateResult`, `TestResult`, `FailureRecord`, `HarnessBootstrap`, `HookDefinition`, `KnowledgeEntry`, `KnowledgeStore`, `KnowledgeSubsystem`, `MaturityLevel`, `QueryFilter`, `DecisionRecord`, `ExecutionTrace`, `TraceFilter`, `IronLawContext`, `ArchitectureContext`, `CrossProjectContext`, `AgentLifecycle`(type)
