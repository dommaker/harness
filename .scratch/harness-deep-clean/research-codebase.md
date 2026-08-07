# harness 源码全景调研报告（工单 02）

> 调研对象：`/root/projects/harness`（@dommaker/harness v0.16.6，分支 `refactor/deep-clean`）
> 排除：node_modules、dist/、coverage/（`src/tools/core/node_modules` 是运行时产物，按约定不算源码）
> 方法：全量 grep/AST 交叉验证，非凭感觉；jest 基线今日实测复核。

---

## 0. 总览数字

| 指标 | 数值 |
|---|---|
| src 非测试 TS 文件总行数 | 33,352 行 |
| >400 行非测试文件 | 21 个（见 §2） |
| 顶层模块数（src 一级目录） | 22 个 |
| 测试文件 | 128 个（今日实测：128 套件全过 / 2167 通过 / 8 skipped / 0 失败，28s） |
| CLI 命令 | 25 个 commander 命令（bin/harness.js，~550 行注册代码） |
| npm exports | `.` / `./core` / `./presets` / `./context` |
| dependencies | chalk / commander / fast-glob / js-yaml / zod（zod 零使用，见 §4） |

---

## 1. 模块地图

### 1.1 入口点

| 入口 | 说明 |
|---|---|
| `bin/harness.js` | CommonJS，静态 `require('../dist/cli/commands/index')`（bin/harness.js:11-53 一次性解构 50 个函数），用 commander 注册 25 个命令。全部命令实现**急切加载**（见 §5.2） |
| `src/index.ts` | 扁平巨型桶：`export *` 了几乎全部 19 个模块 + 便捷 API（`interceptOperation`/`claimOperation`/`registerExecutor`/`checkConstraints`/`checkBeforeExecution`）。主入口一加载即拉起全库（含 `typescript` 运行时依赖问题，见 §4.3） |
| `package.json exports` | `.`→dist/index、`./core`→dist/core/index、`./presets`→dist/presets/index、`./context`→dist/context/index |
| `files` | dist + bin + **src** + templates（npm 包会发布全部 TS 源码；`.npmignore` 单独排除了 `src/tools/core/node_modules`，佐证该目录是隐患运行时产物） |

### 1.2 顶层目录职责（含内部消费情况）

| 目录 | 职责 | 内部消费者（排除 index 桶/测试） |
|---|---|---|
| `core/` | 约束引擎核心：三层约束定义+检查器+拦截器（constraints/）、验证器 checkpoint/passes-gate/cso（validators/）、会话 startup/clean-state（session/）、Spec 验证器（spec/）、项目配置加载 | cli(13 处)、presets、constraints/registry、monitoring/evolver、hooks |
| `cli/` | 25 个命令实现 + commands/index.ts 聚合导出 | 仅 bin（经 dist） |
| `gates/` | 6 种质量门：acceptance/command/contract/performance/review/security | cli(6 处) |
| `knowledge/` | 知识引擎：store/query/lint/audit/lifecycle/import/ingest/migration/doctor/reference-tracker + primitives | cli(8)、context、monitoring、dashboard、tools |
| `monitoring/` | Execution/Performance Trace 收集分析、ConstraintDoctor/Evolver、KnowledgeDoctor/Evolver、context-tracker | cli(flow/status)、**core/checker**、evolution、constraints(1 type) |
| `architecture/` | 架构约束引擎 + 跨项目契约检查 | **无内部消费者（孤岛，仅 index 导出）** |
| `tools/` | 工具注册表：YAML 定义（definitions/ 80+ yml）、loader、registry + core/ 内置工具常量（内含 13MB node_modules 运行时产物，依赖旧版 @dommaker/harness@0.12.13） | **无内部消费者（孤岛）** |
| `context/` | Token 预算/渐进加载/文件与工具输出预算/会话压缩/token 流水线/知识注入 | hooks/bootstrap、knowledge/lifecycle-hooks、monitoring/context-tracker |
| `presets/` | strict/standard/relaxed 预设 + applyPreset | **无内部消费者**——CLI `check --preset` 根本没调用它（见 §7.3） |
| `constraints/` | "新"约束分层：registry/lifecycle-runner/types（与 core/constraints 并存，见 §7.4） | cli(flow)、dashboard、evolution、monitoring(1 type) |
| `types/` | 全部共享类型 |  everywhere；但它自己反向依赖 monitoring/failure（§5.1 分层违规） |
| `failure/` | 错误分类器、失败记录、约束违规处理 | cli(failure/report)、types 桶 |
| `evolution/` | autoEvolve（trace→提案） | **无内部消费者（孤岛）** |
| `dashboard/` | 统计聚合 | **无内部消费者（孤岛）** |
| `llm/` | LLMAdapter 抽象 | evolution、monitoring/constraint-doctor |
| `governance/` | GovernanceExecutor 漂移检测 | **无内部消费者（孤岛）** |
| `hooks/` | 通用 Hook 管线 | **无内部消费者（孤岛）** |
| `agents/` | AgentLifecycle 状态机 | **无内部消费者（孤岛）** |
| `safety/` | 输入/输出/工具 Guardrail + Sandbox | **无内部消费者（孤岛）** |
| `verification/` | VerificationLoop + rules-based | **无内部消费者（孤岛）** |
| `sdd/` | SDD index 生成 | 仅 cli/sdd |
| `spec/` | @spec 注释检查 | 仅 cli/spec（core/spec 是另一个 spec 验证器，见 §7.4） |
| `utils/` | exec/runCommand/isCommandAvailable/detectSourceRoots | 叶子层，被 cli/core/gates/governance 使用 |

**孤岛结论**：`architecture / tools / evolution / dashboard / governance / hooks / agents / safety / verification / presets` 共 10 个模块没有任何仓内生产调用方，仅靠 `src/index.ts` 对外导出。它们是纯对外 API 面，删除/重组前必须核对 studio 使用面快照（工单 03）作护栏。

### 1.3 模块间依赖方向（import 计数，脚本统计）

```
cli ──► core(13) / knowledge(8) / types(8) / utils(7) / gates(6) / monitoring(6) / failure(2) / constraints(1) / sdd(1)
core ──► types(26) / utils(10) / monitoring(1 ← checker.ts:20，违规方向)
monitoring ──► types(6) / knowledge(3) / core(1 ← constraint-evolver.ts:17，反向) / constraints(1) / context(1) / llm(1)
context ──► knowledge(3) / monitoring(1) / utils(1)
knowledge ──► context(1, type-only)
constraints ──► types(3) / core(1 ← registry.ts:11) / monitoring(1, type-only)
dashboard ──► constraints(3) / knowledge(3)
evolution ──► monitoring(4) / constraints(2) / llm(1) / types(1)
presets ──► types(3) / core(1)
hooks ──► core(2) / context(1) / types(1)
types ──► monitoring(2) / failure(1)   ← 类型层反向依赖，见 §5.1
gates ──► utils(5)
utils ──► （叶子，无内部依赖）
```

理想分层应为 `types → core → {gates,knowledge,monitoring,context} → cli`，现状是 core↔monitoring 互指、types 反向依赖 monitoring/failure。

---

## 2. 大文件清单（>400 行，非测试）

| 文件 | 行数 | 臃肿原因 | 拆分方向 |
|---|---|---|---|
| `src/cli/commands/sync-docs.ts` | 1188 | 单函数 `syncDocs` 288 行（48-339）串联 3 条同步线（CAPABILITIES/CONTEXT/AGENTS）；文件内含 ~30 个私有助手（扫描、解析、AGENTS.md PRESERVE 块、治理信息收集、包管理器探测）。三处独立读取 `.harness/config.yml`（537/1023/1114） | 按产物拆 3 个同步器（capabilities/context/agents）+ 共享 ProjectReader（config.yml 只读一次）；PRESERVE 块解析独立为 markdown 工具 |
| `src/core/constraints/checker.ts` | 1169 | **God class** `ConstraintChecker`：1000 行里塞了 ~20 个约束的 precondition 分发（`checkPrecondition` 145 行 switch，217-366）+ 每个约束自带 IO 实现（checkNoBypassCheckpoint/checkYagni/checkNoAnyType/checkCapabilitySync/checkDocsFreshness…各自重复跑 `git diff`、重复解析 config.yml 730/768）+ 4 组向后兼容别名（1135-1169） | 约束定义与检查执行分离：每条约束 = 独立 checker 函数/插件（注册表模式），checker 只留编排+缓存；别名全删 |
| `src/core/constraints/definitions.ts` | 1126 | 三层约束全部字面量堆一个文件：IRON_LAWS 21-347、GUIDELINES 348-1009、TIPS 1010-1050 + 12 个查询助手（1068-1126，含 getAllLaws/getLaw 等纯别名） | 按层拆 3 个文件（或按域：git/test/docs/quality）；助手收敛为 1 个 ConstraintRegistry |
| `src/cli/commands/init.ts` | 832 | 脚手架模板内联：PRESETS/GOVERNANCE_PRESETS 常量（53-148）、pre-commit/GH Actions 模板字符串（260-301）、CLAUDE.md 注入（548-640）、governance workflow 生成（777+），与 `templates/` 目录和 `src/presets` 功能重叠 | 模板移到 templates/ 或独立 scaffolder；预设统一走 src/presets |
| `src/cli/commands/knowledge.ts` | 712 | 13 个子命令的展示逻辑全平铺在一个文件（list/search/import/decay/stats/upsert/sync/audit/snapshot/migrate/index/health），`knowledgeAudit` 99 行、`knowledgeHealth` 96 行 | 按子命令拆文件（knowledge/ 目录），共享 getKnowledgeDir |
| `src/knowledge/audit.ts` | 697 | `KnowledgeAudit` 类 + 前置 ~250 行常量/工具（噪声 pattern、synthetic ref 正则）+ `computeDimensions` 133 行 | 常量/规则表抽出；维度计算按维度拆 |
| `src/core/validators/passes-gate.ts` | 613 | PassesGate 一个类：测试执行、覆盖率提取、失败提取、证据生成/校验、测试文件变更检查、扩展机制（509+ extensions Map） | 拆 runner / coverage-parser / evidence / extension-registry |
| `src/monitoring/constraint-evolver.ts` | 572 | 提案生成（propose/proposeBatch）+ 内容生成 + 风险评估 + markdown 渲染全在一个类 | 拆 proposal-generator / risk-assessor / markdown-renderer |
| `src/architecture/cross-project-checker.ts` | 563 | 4 类检查（API 同步/类型一致/破坏性变更/文档-代码一致）+ 各自的解析助手（findTsFiles 340 与 sync-docs 重复、parseDocInterfaces 等） | 按检查类型拆；文件遍历用共享 util |
| `src/core/validators/checkpoint.ts` | 547 | 14 种 check type 的私有方法平铺（含 output_contains/not_contains 那对问题实现，§7.1） | 按 type 族拆（file_*/command_*/output_*/http_*） |
| `src/cli/commands/update-user-model.ts` | 527 | 会话挖掘全流程：扫描 ~/.claude 会话、纠正提取、概念聚类（jaccardChinese 268）、profile 回写——与 analyze-sessions.ts 大面积重复（§7.2） | 与 analyze-sessions 合并为 session-mining 模块 |
| `src/knowledge/import.ts` | 508 | ColdStartImporter 一个类含 4 个 source importer（code/git/docs/manual）+ 状态持久化 | 每个 source 一个 importer 文件 |
| `src/monitoring/constraint-doctor.ts` | 498 | `ruleBasedDiagnose` 146 行巨型规则分支 + agent 诊断 + 响应解析 | 规则表数据化，诊断器只留分发 |
| `src/gates/acceptance.ts` | 493 | SpecAcceptanceGate：tasks.yml 加载 + 单任务/全量/已完成三模式 + validateTask 96 行 + E2E | 拆 tasks-loader / task-validator / e2e-runner |
| `src/cli/commands/analyze-sessions.ts` | 488 | 与 update-user-model 重复的会话挖掘（n-gram 提取、聚类、候选生成） | 同 update-user-model，合并 |
| `src/core/constraints/doc-freshness/runner.ts` | 486 | FreshnessRunner 按 check type 平铺（changelog_version/context_docs/doc_dir/doc_regex_count），`checkDocDir` 112 行 | 每个 check type 一个文件（策略模式） |
| `src/monitoring/trace-analyzer.ts` | 470 | TraceAnalyzer：统计 + 趋势 + 异常检测（detectAnomalies 96 行） | 拆 statistics / anomaly-detector |
| `src/monitoring/performance-analyzer.ts` | 450 | 与 trace-analyzer 结构同构（detectAnomalies 85 行）——两者存在结构性重复 | 与 trace-analyzer 抽公共分析基座 |
| `src/gates/command.ts` | 444 | DEFAULT_COMMAND_BLACKLIST 数据表 ~175 行 + CommandGate 类 | 黑名单数据移入数据文件/独立模块 |
| `src/cli/commands/check.ts` | 441 | 触发器探测 + 上下文组装（8 个 detect* 助手）+ 结果渲染 + smart hint | detect* 助手移入 core（上下文构造器），渲染独立 |
| `src/knowledge/lifecycle.ts` | 415 | 生命周期状态机 + 晋升/衰减规则 | 规则表外置 |

---

## 3. 死代码候选（全部 grep 交叉验证）

### 3.1 确认可删（仓内零引用，含测试）

| 候选 | 位置 | 验证结果 |
|---|---|---|
| 16 个触发器常量 `CODE_IMPLEMENTATION`/`FILE_MODIFICATION`/…/`ARCHITECTURE_CHANGE` | `src/types/constraint.ts:33-48` | 全仓（含测试、bin、templates）零引用；代码全部使用字符串字面量触发器 |
| `checkpointValidator` 单例 | `src/core/validators/checkpoint.ts`（barrel `core/validators/index.ts` 只导出类，未导出该单例） | 零引用 |
| `createProjectConfigLoader` | `src/core/project-config-loader.ts` | 零引用（仅类本身被 cli/check 使用） |
| `getPerformanceCollector` / `configurePerformanceCollector` | `src/monitoring/performance-collector.ts` | 零引用（经 monitoring/index.ts `export *` 暴露但无人用） |
| 桶文件 `src/constraints/index.ts` | — | 无人 import（src/index.ts 直接引用三个子文件，绕过桶） |
| 桶文件 `src/core/spec/index.ts` | — | 无人 import（cli/spec.ts:14 与 core/index.ts:13 都直接引 `./validator`） |
| `prompt-injection.ts`（整文件） | `src/core/constraints/checker.ts` 同目录 | 头部 `@deprecated 已迁至 @dommaker/studio-shared`；仓内仅自身测试 + `release.ts:109` 的 dist 文件存在性检查引用。**删除需确认 studio 侧确已改用 studio-shared（工单 03 护栏）** |
| `.harness/custom-constraints.yml` | 仓自身配置 | 全文只有注释掉的示例，无一条生效约束 |

### 3.2 向后兼容别名（仓内仅自引用，删前查 studio）

- `checker.ts:1144-1169`：`IronLawChecker`、`checkIronLaw`、`checkAllIronLaws`、`ironLawChecker`（= constraintChecker 改名马甲）
- `definitions.ts:1100-1126`：`getAllLaws`/`findLawsByTrigger`/`getLaw`/`filterLawsBySeverity`（getAllConstraints 系列的别名）
- `types/constraint.ts` 的 `IronLaw*` 兼容类型（经 `core/constraints/index.ts` 注释"向后兼容"导出）
- `presets/standard.ts` 的 `STANDARD_IRON_LAWS_CONFIG`/`getIronLawPreset`（注释标注向后兼容）

### 3.3 仅测试引用、无仓内生产调用（公共 API 面，删除以 studio 快照为准）

`AgentLifecycle`(agents/lifecycle.ts)、`runArchitectureCheck`(architecture/constraint-engine.ts)、`checkDocCodeConsistency`(cross-project-checker.ts)、`SessionCompaction`/`FileBudget`/`KnowledgeInjector`/`ProgressiveLoader`/`AdaptiveTokenBudget`/`ToolOutputBudget`(context/*)、`checkConstraintsSafe`(checker.ts)、`validateSpec`(core/spec/validator.ts)、`validateCheckpoint`(checkpoint.ts)、`DashboardDataProvider`(dashboard/data.ts)、`autoEvolve`(evolution)、`createLLMAdapter`/`DefaultLLMAdapter`(llm/adapter.ts)、`createDoctor`/`createEvolver`/`createAnalyzer`/`createPerformanceAnalyzer`/`configureTraceCollector`(monitoring)、`InputGuardrail`/`OutputGuardrail`/`ToolGuardrail`(safety)、`checkDirectory`(spec/annotation-checker.ts)、`parseToolYaml`/`loadToolsFromDir`/`loadRegistry`/`getToolsDir`/`getRegistryPath`/`ToolRegistry`(tools)、`isCommandAvailable`(utils/exec.ts)、`VerificationLoop`(verification/loop.ts)。

### 3.4 注释掉的代码

全仓只有 1 处 ≥3 行的疑似注释代码块：`src/architecture/constraint-engine.ts:191-194`——实为正则示例说明，非死代码。代码库在这方面干净。

### 3.5 仓库级冗余文件/目录

- `src/tools/core/node_modules`（13MB，pnpm 安装的 @dommaker/harness@0.12.13 + pnpm-lock.yaml）——源码树里的运行时产物，`.npmignore` 专门排除它；`src/tools/core/package.json` 让 harness 依赖旧版自身，怪异
- `.harness/logs`（12MB）等运行时状态（已 gitignore，仅磁盘占用）
- `scripts/release.ts`（npx tsx 本地发布流水线）与 `cli/commands/release.ts`（harness release）**两套发布流水线并存**，且 AGENTS.md 声明"发布走 tag 触发 GA，不本地 npm publish"——scripts/release.ts 整文件过时

---

## 4. 依赖审计

### 4.1 dependencies

| 依赖 | 使用面 | 结论 |
|---|---|---|
| chalk | 22 个文件，**全部在 src/cli/commands**（0 处核心库使用） | 保留；但说明核心层无着色耦合，CLI 独立性好 |
| commander | 仅 `bin/harness.js:9`（src 内 0 处） | 保留 |
| fast-glob | 仅 `src/core/spec/validator.ts:14` | 使用面极窄，可用 fs.readdir 递归替换 |
| js-yaml | ~19 个非测试文件（cli 3、core 3、core/session 2、gates、governance、knowledge 3、sdd、tools、hooks 测试等） | 保留，核心依赖 |
| **zod** | **全仓零引用**（src/bin/scripts/templates 全查） | **删除** |

### 4.2 devDependencies

| 依赖 | 结论 |
|---|---|
| **@types/glob** | **删除**——全仓无任何 `glob` import（用的是 fast-glob，自带类型） |
| @jest/globals 与 @types/jest 并存 | jest 29 下 @jest/globals 足够，@types/jest 可评估二选一 |
| 其余（jest/ts-jest/eslint/typescript/@types/node） | 正常 |

### 4.3 隐式运行时依赖（bug）

`src/knowledge/primitives/code-structure.ts:16` `import * as ts from 'typescript'`——typescript 只是 devDependency，但该文件经 `knowledge/index.ts:22` → `src/index.ts` 进入主入口。**消费者安装 @dommaker/harness 后 require 主入口即要求运行时存在 typescript**（本地因 node_modules 有而未暴露）。必须：移入 optionalDependencies/peer 或改为懒加载（动态 require + 功能降级）。

### 4.4 锁文件

`pnpm-lock.yaml` 已在 commit 76a9b66 删除（CI 4 个 workflow 与 publish 均 `npm ci`），保留 `package-lock.json`。注意 `src/tools/core/` 内还有一份子级 pnpm-lock.yaml（随 node_modules 一起属运行时产物，建议整体移出 src）。

---

## 5. 循环依赖与性能热点

### 5.1 循环/分层违规

1. **core ↔ monitoring 模块级循环**：`core/constraints/checker.ts:20` → `monitoring/traces`(getTraceCollector，值导入)；`monitoring/constraint-evolver.ts:17` → `core/constraints/definitions`(值导入)。当前没炸仅因两边都打到叶子文件而非桶。checker 对 trace 的依赖应反转为注入/回调（src/index.ts 的 `checkConstraints` 已有 onTrace 回调选项，说明方向已知）。
2. **types 层反向依赖**：`src/types/index.ts:19-23` 从 `../monitoring/constraint-doctor`、`../monitoring/constraint-evolver` 再导出 `Diagnosis`/`ConstraintProposal`；`types/index.ts:51-59` 从 `../failure/types` 再导出。类型模块依赖业务模块，分层倒挂。
3. constraints/registry.ts:11 → core/constraints/definitions（新 constraints 模块反依赖旧 core）。
4. knowledge ↔ context：值导入单向（context/knowledge-injector → knowledge/query），knowledge 侧仅 type-only（lifecycle-hooks.ts:12），运行时无环。

### 5.2 启动路径

- `bin/harness.js` 静态 require `dist/cli/commands/index` → **任何子命令（含 --version）急切加载全部 25 个命令实现**。实测（dist）：加载 82ms / 164 个模块。无懒加载、无按需 require。
- 主入口 `src/index.ts` 同理：`export *` 全部模块，库消费者拉全量。

### 5.3 重复 IO / 重复计算（grep 统计：src 内同步 IO 调用 274 处）

| 热点 | 位置 | 说明 |
|---|---|---|
| `git diff --cached` 单次 check 至少跑 4 遍 | `checker.ts:524,595,605,674`（另有 548 处按文件遍历）+ `cli/commands/check.ts:32` | CheckCache 本为缓存它而设计，但实际只用于 `src_scan`（checker.ts:630 唯一一处 `this.cache`），git diff 完全没走缓存 |
| CheckCache TTL=1000ms | `checker.ts:72` | 对单次 CLI 调用意义有限；设计意图（跨调用共享）与用法脱节 |
| `.harness/config.yml` 至少 6 处独立解析 | `core/project-config-loader.ts:46`（正规加载器）、`checker.ts:730,768`（内联 yaml.load）、`sync-docs.ts:537,1023,1114`（同命令内读 3 次）、`hooks/bootstrap.ts:38`、`governance/executor.ts:168` | 无全局配置缓存；同一次 `harness check` 内可重复解析同一文件 |
| `git ls-tree HEAD` 每个变更文件 spawn 一次（execSync 同步阻塞） | `cli/commands/check.ts:47 isNewDirectory` | N 个文件 = N 次进程启动 |
| 每条约束独立做文件系统/git 检查，无共享上下文 | checker.ts 各 `check*` 私有方法 | checkPrecondition 逐条分发，git diff/CAPABILITIES.md 等被反复读 |
| readFileSync 热点文件 | checker.ts(10)、doc-freshness/runner.ts(6)、check.ts(6)、cross-project-checker.ts(6)、knowledge/import.ts(5) | 同步 IO 总量 274 处 |

---

## 6. 代码坏味道

### 6.1 超长函数（AST 实测，>100 行）

| 函数 | 位置 | 行数 |
|---|---|---|
| `syncDocs` | cli/commands/sync-docs.ts:48 | 288 |
| `flow` | cli/commands/flow.ts:55 | 221 |
| `release` | cli/commands/release.ts:41 | 193 |
| `ruleBasedDiagnose` | monitoring/constraint-doctor.ts:164 | 146 |
| `checkPrecondition` | core/constraints/checker.ts:217 | 145 |
| `status` | cli/commands/status.ts:28 | 142 |
| `computeDimensions` | knowledge/audit.ts:457 | 133 |
| `checkDocDir` | core/constraints/doc-freshness/runner.ts:173 | 112 |
| `check` | cli/commands/check.ts:87 | 106 |

90-99 行梯队：knowledgeAudit(99, knowledge.ts:526)、contract.check(97)、knowledgeHealth(96)、acceptance.validateTask(96)、trace-analyzer.detectAnomalies(96)。

### 6.2 重复逻辑集中点

1. **会话挖掘两套实现**：`analyze-sessions.ts` 与 `update-user-model.ts` 各自扫描 ~/.claude 会话、提取纠正、聚类（jaccardSimilarity:482 vs jaccardChinese:268 两个近同算法）。
2. **文件树遍历三份**：`sync-docs.ts:382 findTsFiles`（async）、`cross-project-checker.ts:340 findTsFiles`（sync）、`checker.ts:864 findSourceFiles`。
3. **CAPABILITIES.md 解析两份**：checker.ts:651/827 与 sync-docs.ts:437/569 各自实现解析+更新。
4. **预设两套**：`src/presets/standard.ts`（applyPreset 体系）vs `cli/commands/init.ts:53-148`（PRESETS+GOVERNANCE_PRESETS 另一套形状）。
5. **发布流水线两套**：scripts/release.ts vs cli/commands/release.ts（§3.5）。
6. **trace-analyzer / performance-analyzer 同构**：统计+趋势+异常检测的镜像实现。
7. **checkpoint.ts 正反检查成对复制**：file_contains/not_contains、output_contains/not_contains 逻辑镜像。

### 6.3 其他

- `cli/commands/check.ts` 的 `--preset` 选项**只打印不生效**（check.ts:89 仅 console.log，preset 从未传入 checker；src/presets 在 CLI 链路上零调用）；CI workflow（harness-check.yml）的 preset 输入因此也是摆设。
- `harness validate` 非 strict 模式失败不退出（validate.ts:96-104 只打印 🛑，exit 0），pre-commit 的 `|| exit 1` 兜底永不触发（§7.1）。
- `src/cli/commands/` 目录里混着一个 `CONTEXT.md`，会被 doc-freshness 计数类检查误计入（doc_regex_count 靠 exclude 名单维护，脆弱）。

---

## 7. Dogfooding 配置问题（仓库自身 .harness/ + hooks + CI）

### 7.1 pre-commit + checkpoints.yml（问题最集中）

`.git/hooks/pre-commit` 执行 `harness check --staged` + `harness validate` + 零字节检测：

1. **no-console checkpoint 必败且报告诡异**（用户所见"输出包含内容:"后为空的根因，三因叠加）：
   - `.harness/checkpoints.yml` 用 `type: output_not_contains` + `config.command: grep -r "console.log" src/ || true` + `expected: ''`。但 `checkOutputNotContains`（**checkpoint.ts:323-335**）根本不执行 `config.command`——它检查的是 `context.output`，而 `harness validate` 构造的 context 没有 output（validate.ts:66-69 只给 projectPath/workdir），`stringifyOutput(undefined)` 得 `''`（checkpoint.ts:508-516）。
   - `expected: ''` → `''.includes('') === true` 恒成立 → 恒判"包含" → **永远失败**，失败消息 `输出包含内容: `（content 为空串）——与用户观察完全一致。
   - 语义也错：harness 自己就是 CLI 产品，src 内有 **635 处** 合法 console.log；且即便真跑 `grep -r "console.log" src/` 也会扫进 `src/tools/core/node_modules`。
2. **validate 门禁形同虚设**：非 strict 失败 exit 0（§6.3），hook 的 `npx harness validate || exit 1` 永远放行。
3. **`set -e` 使友好错误分支成为死代码**：hook 顶部 `set -e`，`CHECK_OUTPUT=$(npx harness check --staged 2>&1)` 一旦失败，脚本当行退出，后面 CHECK_EXIT 判断与 resolutions.json 已知解法提示（RKB dogfood）永远执行不到。
4. **"快速 <3s" 注释与事实不符**：checkpoints.yml 含 `npm run build`（build-success）与 `npm test`（test-pass）两个 command_success 检查点，每次 commit 全量构建+全量测试（注释声称全量测试交给 CI）。
5. hook 注释提到 `harness resolve` 步骤，实际命令不存在（CLI 无 resolve 命令），注释失真。

### 7.2 .harness/config.yml

- `harness.version: 0.12.16` vs package.json 0.16.6 —— 版本戳过时。
- `custom-constraints.yml` 全文注释示例，无实际内容（§3.1）。
- 整个 `.harness/` 被 gitignore（"Runtime state"）——**dogfooding 配置本身不进版本控制**，AGENTS.md 明确记载其后果："本地 .harness/config.yml 的自定义 doc_freshness 配置会掩盖内置铁律检查，本地全过 CI 红"。
- `.harness/logs` 12MB 无轮转迹象。

### 7.3 CI dogfooding（.github/workflows/）

- `harness-check.yml`：用 **npm 上已发布的** `npx @dommaker/harness` 检查 harness 自己（鸡生蛋，且检查的是旧版行为）；`npm ci` 带 `continue-on-error: true`（装依赖失败也继续）；`validate` 步骤也是 continue-on-error。
- `harness-governance.yml`：本地 build 后 `npx harness check`（合理）+ `sync-docs --check` continue-on-error。
- preset 输入传给 `--preset`，但该选项不生效（§6.3）。

---

## 8. 测试健康度

今日实测（`npx jest --silent`，分支 refactor/deep-clean）：

```
Test Suites: 128 passed, 128 total
Tests:       8 skipped, 2167 passed, 2175 total
Time:        28.266 s
```

与 map.md 记录基线一致，全绿。测试按模块就近放 `__tests__/`（另有根级 `__tests__/` 44 个集成测试 + `src/__tests__/context/`）。jest.config.js 存在；coverage 门槛 ≥79%（coverage-gate.yml）。

---

## 9. 重构优先级速览（供 triage 引用）

**低风险快赢**
1. 删 zod、@types/glob 依赖（零使用，§4）
2. 删 types/constraint.ts:33-48 死常量、checkpointValidator/createProjectConfigLoader/getPerformanceCollector 等死导出（§3.1）
3. 删两个无引用桶（constraints/index.ts、core/spec/index.ts）
4. scripts/release.ts 删除（与 cli/release 重复且流程已废）

**结构调整**
5. checker.ts God class → 约束检查器注册表化；顺带消除 git diff×4、config.yml×6 重复 IO（§5.3）
6. definitions.ts 按层/域拆分；删 IronLaw* 别名族（先核对 studio）
7. CLI 懒加载（bin 动态 require 或 commander 子命令按需加载）
8. types 层去反向依赖（Diagnosis/ConstraintProposal/failure 类型归位）；core↔monitoring 依赖反转
9. session-mining 两命令合并；文件遍历/CAPABILITIES 解析抽共享 util
10. typescript 隐式运行时依赖修复（§4.3）

**dogfooding 修复**
11. checkpoints.yml no-console 重写（file_not_contains + 排除 node_modules，或干脆删除——CLI 产品不该有此约束）
12. validate 失败必须 exit 1（或 hook 加 --strict）；pre-commit `set -e` 与错误分支冲突修复
13. .harness/config.yml 是否纳入版本控制需决策（当前 gitignore 导致本地/CI 漂移）

**删除护栏**：§1.2 的 10 个孤岛模块与 §3.2/§3.3 全部"仅导出/仅测试"符号，删除前逐一比对 studio 使用面快照（工单 03）。
