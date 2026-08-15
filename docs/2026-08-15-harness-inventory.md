# harness 现状全量盘点（wayfinder #27）

> 盘点对象：`@dommaker/harness` master @ `57f8e07`（v0.17.1）
> 方法：静态 grep 证据 + `tsc --noUnusedLocals --noUnusedParameters` + jest 实测。所有结论带 文件路径:行号 证据。
> 范围：只盘点与分类，不下删除结论。已在上次 deep-clean（`.scratch/harness-deep-clean/report.md`）清理过的项不再重复报告。

---

## 一、子系统消费分层

判定口径：**高消费** = studio 程序化 import + harness 内部有运行时消费；**低消费** = 仅单一入口（CLI / studio 单点 / 仅类型）；**疑似孤儿** = 无 studio 消费、无内部运行时消费、无 CLI 命令暴露。

studio 侧 import 面（生产代码，非测试）来源：`grep -rn "@dommaker/harness" /root/projects/studio/packages /root/projects/studio/apps --include="*.ts"`（排除 `__tests__`/`node_modules`/`dist`），共 116 行、约 50 个文件。

| 子系统 | 源码行数 | studio 消费 | harness 内部消费 | CLI 命令 | 分层 |
|---|---|---|---|---|---|
| `src/types/` | 13 文件 | 高（ConstraintContext/ExecutionTrace/SourceRef/KnowledgeEntry 等约 20 个类型） | 全仓基础层 | — | **高消费** |
| `src/utils/` | 3 文件 | 无（不在 `src/index.ts` 导出面） | exec/file-walk/detect-source-roots 被 core+cli 消费 | — | 内部基础（高） |
| `src/core/` | 6426 | 高（`checkConstraints`/`checkBeforeExecution`/`getAllConstraints`/`IRON_LAWS`/`GUIDELINES`/`PROMPTS`/`CheckpointValidator` 类型等） | 全仓依赖 | check/validate/constraints… | **高消费** |
| `src/knowledge/` | 4017 | 高（FileKnowledgeStore/KnowledgeStore/KnowledgeIngest/KnowledgeQuery/KnowledgeLifecycle/KnowledgeLinter/ReferenceTracker/KnowledgeAudit/ColdStartImporter/KnowledgeHealthScorer 等） | CLI knowledge/constraints-retire 消费 | knowledge | **高消费** |
| `src/gates/` | 2190 | 中（PassesGate、CommandGate（`require.resolve` dist/gates/command.js）、CheckpointValidator 类型） | CLI 6 门禁命令 | acceptance/performance/security/contract/review/command | 高（库+CLI 双消费） |
| `src/monitoring/` | 2847 | 中（getTraceCollector、ExecutionTrace、TraceFilter） | check/report/constraints-report 消费 | 经 check/report | 中 |
| `src/failure/` | 574 | 中（ErrorClassifier、FailureRecord、createFailureRecorder、ErrorType、FailureLevel） | CLI failure 命令 | failure | 中 |
| `src/hooks/` | 474 | 中（HookRegistry、HookPipeline、bootstrapHarness、HookDefinition） | bootstrap 单例（`src/hooks/bootstrap.ts`） | — | 中 |
| `src/context/` | 2027 | 低（仅 KnowledgeInjector，`knowledge-singletons.ts:18`） | 仅 SessionManager（`hooks/bootstrap.ts:17`） | — | **低消费**（6/10 文件孤儿，见 §三） |
| `src/presets/` | 160 | 无（studio 经 config.yml `preset:` 字符串间接生效） | `effective-constraints.ts` applyPreset | init/check `--preset` | 内部（中） |
| `src/spec/` | 342 | 无（spec annotation 无人 import） | CLI spec 命令 | spec | 低（仅 CLI） |
| `src/sdd/` | 109 | 无 | CLI sdd 命令 | sdd | 低（仅 CLI） |
| `src/agents/` | 249 | 低（仅 `AgentLifecycle` 类型，`agents.routes.ts:17`） | 无运行时消费者 | — | 低（仅类型） |
| `src/tools/` | 611 + definitions 760K | 低（仅 `getRegistryPath`/`getToolsDir`，`capabilities/routes.ts:5`、`capability.service.ts:12`） | 无（registry/loader/core 无人引用） | — | **低消费**（registry/loader/core 孤儿，见 §三） |
| `src/architecture/` | 896 | 无 | 仅经 `default-executors.ts` 注册、无内置约束触发 | 无 | **疑似孤儿** |
| `src/safety/` | 756 | 无 | 无 | 无 | **疑似孤儿** |
| `src/verification/` | 373 | 无 | 无 | 无 | **疑似孤儿** |
| `src/dashboard/` | 363 | 无 | 无 | 无 | **疑似孤儿** |
| `src/llm/` | 232 | 无 | 仅类型（`constraint-doctor.ts:18` 引 `LLMAdapter` 类型，无运行时实例） | 无 | **疑似孤儿** |

合计：`src/` 约 33194 行源码（不含测试）。疑似孤儿子系统约 **2860 行**（architecture 896 + safety 756 + verification 373 + dashboard 363 + llm 232）+ context 内孤儿约 1341 行 + tools 内孤儿约 576 行 ≈ **4800 行** 无消费代码（不含对应测试文件）。

---

## 二、CLI 命令审计（26 个）

studio 程序化调用（spawn/exec/scripts，非注释）实测只有 5 个命令：`constraints --json`（`studio-agent/src/services/output-capture.ts:220`）、`sync-docs`（`.github/workflows/ci.yml:29`、`scripts/release.ts:49`、`package.json:46`）、`check`（`ci.yml:29`、`scripts/release.ts:53`）、`init`（`scripts/harness-sync.js:40`）、`update-user-model`（`agents/monitor/monitor-system-probes.ts:197`，**但传了不存在的 `--days` flag，见下**）。另有 `apps/api/src/cli/data.ts:93` 的 `studioHarnessCli` 通用透传（`npx harness ${args}`），任意命令都可由人经 `studio harness <args>` 手动触发。

| 命令 | 实现文件 | 行数 | studio 程序化调用 | 测试 | 备注 |
|---|---|---|---|---|---|
| check | check.ts | 276 | 是（ci.yml/release.ts） | 3 个测试文件 | 核心 |
| validate | validate.ts | 202 | 否（仅 harness 自身 `harness-check.yml:33`） | 有 | harness CI 复用 workflow |
| passes-gate | passes-gate.ts | 158 | 否（仅 `harness-governance.yml:31`） | 有 | 同上 |
| init | init.ts | 860 | 是（harness-sync.js:40） | 有 | 最大命令 |
| sync-docs | sync-docs/（6 文件） | 1332 | 是（ci.yml/release.ts/package.json） | 有 | 模块族已拆分 |
| constraints | constraints.ts | 86 | 是（`--json`，output-capture.ts:220） | 有 | |
| constraints report | constraints-report.ts | 234 | 否（人工/注释引用） | 有 | |
| constraints retire | constraints-retire.ts | 535 | 否（人工/注释引用） | 有 | |
| update-user-model | update-user-model.ts | 463 | 是（但 flag 错误） | **无测试** | studio 传 `--days 1`，命令仅支持 `--json`/`--dry-run`（`bin/harness.js:479-480`、`update-user-model.ts:30-32`），commander 报 unknown option → `|| echo "{}"` 兜底，监控探针恒拿空结果 |
| report | report.ts | 200 | 否 | 有 | |
| status | status.ts | 168 | 否 | 有 | |
| spec | spec.ts | 158 | 否 | 有 | |
| acceptance | acceptance.ts | 111 | 否 | 有 | |
| performance | performance.ts | 108 | 否 | 有 | |
| security | security.ts | 122 | 否 | 有 | |
| contract | contract.ts | 168 | 否 | 有 | |
| review | review.ts | 118 | 否 | 有 | |
| command | command.ts | 90 | 否（库面 CommandGate 被 studio provider-hooks 复用） | 有 | |
| knowledge | knowledge.ts | 712 | 否（仅 skill 字符串提及） | 有 | |
| sdd | sdd.ts | 44 | 否 | 逻辑有测（`sdd/__tests__/index-generator.test.ts`），CLI 壳无测 | |
| failure | failure.ts | 117 | 否 | 有 | |
| posteval-plan | posteval-plan.ts | 84 | 否 | 有 | |
| release | release.ts | 233 | 否 | **无测试** | 自用发布流水线 |
| analyze-sessions | analyze-sessions.ts | 334 | 否 | **无测试** | |
| doc-freshness-check | doc-freshness-check.ts | 386 | 否 | 有 | |
| spec-baseline-check | spec-baseline-check.ts | 377 | 否 | 有 | |

**无测试命令 3 个**：`update-user-model`（463 行）、`analyze-sessions`（334 行）、`release`（233 行），共 ~1030 行零测试，违反 CLAUDE.md「Every new gate MUST have … a test file」精神。

---

## 三、退役物 / 死代码残留

1. **TIPS 空表**（`src/core/constraints/definitions.ts:19-23`）：`export const TIPS = {}`，`@deprecated`，注释自称「仅为在途 capabilities-syncer 编译兼容保留」。但 `capabilities-syncer.ts:11,82,119` 仍 `Object.keys(TIPS).length` 生成恒为 0 的 Tips 计数；`checker.ts:20,166` 仍把 `tips: TIPS` 塞进 `getConstraints()` 返回；`src/types/constraint.ts:10,285` 仍保留 `tip` 层级与 `tips/tipCount` 字段兼容。→ 空表已穿透 checker + sync-docs + 类型三层，可整链摘除。

2. **`@deprecated` 共 4 处**（`grep -rn "@deprecated" src/`）：
   - `src/core/constraints/definitions.ts:20` TIPS（见上）。
   - `src/core/constraints/checker.ts:145-151` `setCustomConfig`：标注「修改单例状态，多项目并发污染风险」，但 `src/cli/commands/check.ts:52` **仍在调用**——deprecated 却是 CLI check 的主路径。应迁移到 per-request `customConfig` 参数后再删。
   - `src/knowledge/types.ts:14-15` `KnowledgeType`：`@deprecated Use KnowledgeSubsystem`，但被 20+ 处内部文件（knowledge/dashboard/context/cli）使用，反而是主流名。→ 命名债：应统一到 `KnowledgeSubsystem` 并删别名。
   - `src/cli/commands/sync-docs/capabilities-syncer.ts:39-42` `isCapabilityListingFormat`：`@deprecated`「收敛到 capabilities-parser」，此处是 re-export，但 `sync-docs/index.ts:26,116` 仍从此 re-export 消费。注释与事实不符。

3. **`tsc --noEmit --noUnusedLocals --noUnusedParameters` 有 1 处残留**（上次 deep-clean 报告称 61 处清零，现新增回归）：
   `src/cli/commands/constraints-retire.ts(50,1): error TS6133: 'getConstraintsMeta' is declared but its value is never read.`

4. **knip**：`package.json` devDependencies 无 knip，未跑（任务约束「除 gh api 外不用网络」，`npx knip` 会下载）。

5. **bin/ 钩子脚本全孤儿**：`bin/` 现仅 2 脚本 `harness-knowledge-track.sh`、`harness-sensitive-check.sh`。全仓 + studio 检索无任何代码引用（仅 `harness-sensitive-check.sh:7` 自述由 knowledge-track.sh 维护状态文件，二者互指）。`no_hardcoded_credentials` checker 已内联正则实现（`src/core/constraints/checkers/no-hardcoded-credentials.ts:45-55`），不 shell 调用 sensitive-check.sh。→ 2 脚本均无消费者。

6. **orphan 子模块（子系统表 §一的展开）**：
   - `src/architecture/`（896 行，0 测试）：仅被 `src/core/constraints/default-executors.ts:89-92` 注册 `architecture-check`/`cross-project-check` 两个 enforcement executor，且 `interceptor.ts:204-205` 模块导入时副作用注册；但内置约束 definitions（iron-laws/guidelines/prompts.ts）无一使用这两个 enforcement ID（`grep enforcement` 见 credential-scan/checkpoint-required/verify-completion/… 共 19 个，无 architecture-*）。→ 注册了却永不触发，仅 custom 约束可经此 ID 命中。
   - `src/safety/`（756 行，4 测试）：Sandbox/Input|Output|ToolGuardrail 无任何 src 内消费者（`grep` 仅 `session-manager.ts:4`、`agents/types.ts:18` 散文提及「Sandbox」）。
   - `src/verification/`（373 行，2 测试）：rules-based + loop 验证，仅 `src/index.ts:74` 导出，无 CLI、无消费者。
   - `src/dashboard/`（363 行，2 测试）：仅 `src/index.ts:79` 导出，无 CLI、无消费者。
   - `src/llm/`（232 行，1 测试）：`adapter.ts` 实现无运行时消费者；仅 `monitoring/constraint-doctor.ts:18,57-59` 以 `LLMAdapter` **类型**可选项引用，且 `createDoctor` 调用处从不传 llm。与 CLAUDE.md「零 Token 成本 / 不调用 LLM」设计原则相悖。
   - `src/context/` 内 6 文件孤儿（共 1341 行）：`token-budget.ts`(295)、`progressive-loader.ts`(260)、`token-pipeline.ts`(265)、`compaction.ts`(201)、`tool-output-budget.ts`(178)、`file-budget.ts`(142)——src 内外均 0 引用（仅 index.ts 桶 re-export）。
   - `src/tools/` 内孤儿（约 576 行）：`core/index.ts`(201，FILE/GIT/NPM/SHELL/CORE_TOOLS)、`registry.ts`(128，ToolRegistry)、`loader.ts`(216，ToolLoader)、`types.ts`(46) 无任何消费者；仅 `paths.ts`(15，getRegistryPath/getToolsDir) 与 `definitions/`(760K，113 yml) 被 studio 消费。

---

## 四、公开 API 面

**导出结构**：`src/index.ts` 用 `export *` 从 17 个 barrel 全量导出（`src/index.ts:23-108`）：types/core/gates/monitoring/failure/architecture/spec/context/knowledge/safety/verification/dashboard/llm/tools/hooks/agents/presets，另加 6 个便捷函数（interceptOperation/claimOperation/registerExecutor/checkConstraints/checkBeforeExecution + `interceptor` 常量，`src/index.ts:124-191`）。全量导出符号约 100+（含类型与类）。

**studio 实际 import 面**（生产代码去重后约 40 个符号）对照导出面，标出「studio 未用」符号（证据：studio import 面 grep 无命中 + src 内部无消费）：

- **studio 未用且仅内部用**（保留理由充分，供 grilling 参考）：`getConstraint`/`findConstraintsByTrigger`、`applyPreset`/`getPreset`、`bootstrapHarnessSync`、`SessionManager`、`spec`/`annotation-checker` 族、`sdd` index 族等——被 harness 自身 CLI/内部消费。
- **studio 未用且完全无消费**（= §三第 6 项孤儿）：architecture/safety/verification/dashboard/llm/tools(registry|loader|core)/context(6 文件) 的全部导出符号。
- **studio 未用但属门禁产品面**：ReviewGate/SecurityGate/PerformanceGate/ContractGate/SpecAcceptanceGate/create*Gate 工厂、`CommandGate`（studio 实际经 `require.resolve` 绕过 exports 直取 dist/gates/command.js，见下）。

**exports 边界泄漏**（`package.json:24-52`）：
- 仅暴露 `.` / `./core` / `./presets` / `./context` 四个子路径，但 `exports` 未封 `./knowledge`/`./gates` 等——studio `provider-hooks.ts:26-28` 用 `require.resolve('@dommaker/harness')` 拿包根目录再拼 `dist/gates/command.js`（`provider-hooks.ts:28`），**绕过 exports 白名单走文件系统路径**，属脆弱的深路径依赖。`studio/knowledge/rule-scanner.ts:223` 亦硬编码 `@dommaker/harness/src/core/constraints/definitions/${file}` 源路径字符串。
- `package.json:41-45` `files` 含 `"src"` + `"templates"` + `"bin"`：TypeScript 源码整体发布（支持上面 rule-scanner 的源路径解析），包体积大且暴露内部实现。

**JSDoc 覆盖抽查**：`src/index.ts` 便捷函数均有 JSDoc；抽查 `dist/verification/rules-based.d.ts`/`dist/context/token-budget.d.ts` 等类与方法均有 JSDoc。因 `export *` 面过宽，逐符号 JSDoc 无法机器保证，抽查基本达标，不列为硬伤。

---

## 五、性能 / 工程卫生

1. **CLI 懒加载是「半懒」**：`bin/harness.js:16-18` 的 `cmd(name)` 用单一 `require('../dist/cli/commands/index')`，而 `src/cli/commands/index.ts` 是 re-export 全 25 命令文件的 barrel。效果：`--version`/`--help` 快（不加载命令桶），但**任一命令执行即加载全部命令实现**，未做到 per-command 懒加载。上次报告「--version 加载模块 173→9」属实，但命令级隔离未实现。

2. **config.yml 解析 memo 仍成立**（验证上次报告）：`src/core/project-config-loader.ts:35-69` `loadRawProjectConfig` 带 `mtimeMs+size` 指纹的 `rawConfigCache`，进程级解析一次。

3. **check 流程 git 调用 run 级 memo 仍成立**：`src/core/constraints/checker.ts:97-120` `memoRun` 包住 `git_diff_staged` 与 `git_diff_staged_names`，单次 check 各执行一次；`CheckCache`（`src/core/constraints/check-cache.ts`）+ `src/core/constraints/context-builder.ts` 承担 readdir 类 I/O。未见回归。

4. **4 个 runtime 依赖均真用**：chalk（23 个 CLI 命令文件）、commander（`bin/harness.js:9`）、fast-glob（`src/core/spec/validator.ts:14`）、js-yaml（project-config-loader/store/init/validate/constraints-retire 等 10+ 文件）。无零使用依赖。

5. **node 版本兼容**：`engines >=18.0.0`；源码使用 `fetch`（`knowledge.ts:305`、`check-handlers/http.ts`）与 `AbortSignal.timeout`（`check-handlers/http.ts:34,66`），Node 18 可用，`@types/node ^20` 提供类型。compat 成立，无 >=18 越界调用。

6. **测试套件**：`npx jest --listTests` = **131 套件**（deep-clean 报告基线 127，+4）。抽样实测 `constraints-retire.test.ts` + `core/constraints/__tests__` 共 4 套件 56 测试全绿，约 7s（`time npx jest`，含冷启动）。环境可跑。

7. **dist 卫生**：`dist/` gitignored（`.gitignore:7`），`npm run build` 用 `rm -rf dist && tsc`（`package.json`），构建产物不提交、不残留。当前本地 `dist/tools/core` 与 `src/tools/core` 一致（非陈旧）。

8. **templates 本地 78M**（`du -sh templates/` = 78M，`templates/node-api/node_modules` 为主）：该 node_modules 未被 git 跟踪（`git ls-files templates/node-api/node_modules` = 0），gitignored；npm 默认排除嵌套 node_modules 不发布。属本地盘卫生问题，非仓库/发布 bloat，优先级低。

9. **package.json 元数据陈旧**：`repository.url`/`bugs.url`/`homepage` 仍指向 `https://github.com/kww/harness`（`package.json:76-83`），实际仓库为 `dommaker/harness`。`author: "kww"`（`:12`）待核。

10. **文档漂移**：`CAPABILITIES.md:32-33` 仍列 `harness-knowledge-check.js`、`harness-knowledge-capture.js`（已删），仅剩 2 脚本。`src/index.ts:6-9` 头部注释仍描述旧「三层约束体系（Iron Laws/Guidelines/Tips）」与 ADR-0001 二元模型不符；`src/index.ts:87-89` 留下空的「治理模块导出」注释段。`CAPABILITIES.md:4` 标题「26」与列名「24 个」不齐（constraints report/retire 以子命令计入）。

11. **docs/ 与 AGENTS.md 未纳入版本控制**（治理）：`.gitignore:29-33`「Internal agent docs」块整体忽略 `AGENTS.md`/`CLAUDE.md`/`specs/`/`docs/`。实测 `git ls-files docs/` 为空——ADR-0001（`docs/adr/0001-constraint-system-rearchitecture.md`）与全部研究文档（`docs/2026-08-15-*.md` 等）零跟踪；根级 `AGENTS.md` 亦未跟踪；`CLAUDE.md` 是唯一例外（已入仓）。CLAUDE.md:125 大量引用 `docs/adr/` 与 `docs/agents/domain.md`，但 HEAD 中无对应文件，决策链/研究基线不可 git 回溯。npm 发布排除可用 `package.json` `files` 白名单替代 gitignore，不必因「不发布内部文档」而整体忽略 docs/。

---

## 六、重复基建

1. **文件遍历未收敛**：`utils/file-walk.ts` 的 `walkFiles` 仅被 `spec-baseline-check.ts:11,165`、`doc-freshness-check.ts:11,155` 两处使用，仍有 ~10 处裸 `fs.readdirSync` 递归遍历：`spec/annotation-checker.ts:257`、`architecture/cross-project-checker.ts:67`、`tools/loader.ts:155`、`sdd/index-generator.ts:48`、`core/spec/validator.ts:14`（fast-glob 独立实现）、`context-builder.ts:147,235`、`doc-freshness/runner.ts:249` 等。上次报告「5 处遍历收敛」只覆盖了部分，递归遍历仍多处重复实现。

2. **约束定义解析双轨**：`core/constraints/capabilities-parser.ts`（`isCapabilityListingFormat`/`readCapabilitiesEntries`）为收敛点，但 `sync-docs/capabilities-syncer.ts:12,42` 又 re-export 并保留旧的 `buildCapabilityChecks`/计数逻辑，与 capabilities-parser 存在重叠（见 §三 @deprecated 第 4 处）。

3. **config 解析已收敛**（验证成立）：6 处内联 yaml 解析收敛到 `loadRawProjectConfig`（§五 2），未发现新重复。

---

## 七、结论：三张清单

### 删除候选（无消费者 / 空表 / 孤儿，供 HITL grilling）

| # | 目标 | 证据 | 影响面 | 置信度 |
|---|---|---|---|---|
| D1 | `src/architecture/` 全部（896 行，0 测试）+ `default-executors.ts:11-87` 两个 executor | 注册但内置约束无 enforcement ID 触发（`default-executors.ts:89-92`；definitions 无 architecture-*） | `registerExecutor('architecture-check'|'cross-project-check')`；studio 零消费 | 高（需确认无 custom 约束依赖该 ID） |
| D2 | `src/safety/` 全部（756 行，4 测试） | 无消费者（`grep` 仅散文提及） | 导出 Sandbox/Input|Output|ToolGuardrail | 高 |
| D3 | `src/verification/` 全部（373 行，2 测试） | 仅 `index.ts:74` 导出 | 导出 RulesBasedVerification/loop | 高 |
| D4 | `src/dashboard/` 全部（363 行，2 测试） | 仅 `index.ts:79` 导出 | 导出 stats/data | 高 |
| D5 | `src/llm/` 全部（232 行，1 测试） | adapter 无运行时消费者，仅类型引用（`constraint-doctor.ts:18`） | 导出 LLMAdapter；违背零 LLM 原则 | 高 |
| D6 | `src/tools/core/` + `registry.ts` + `loader.ts` + `types.ts`（约 576 行，3 测试） | 无消费者（`grep` 仅定义处） | 导出 FILE/GIT/NPM/SHELL/CORE_TOOLS、ToolRegistry、ToolLoader | 高（保留 paths.ts + definitions/） |
| D7 | `src/context/` 6 文件（1341 行）：token-budget/progressive-loader/token-pipeline/compaction/tool-output-budget/file-budget | 0 外部引用（`grep` 逐一核实） | 导出 TokenBudget/ProgressiveLoader/Compaction 等 | 高（保留 session-manager + knowledge-injector + types） |
| D8 | `TIPS` 空表及其穿透链 | `definitions.ts:19-23`、`checker.ts:20,166`、`capabilities-syncer.ts:11,82,119`、`types/constraint.ts:10,285` | `getConstraints().tips`、sync-docs 计数、类型字段 | 高 |
| D9 | `bin/harness-knowledge-track.sh` + `bin/harness-sensitive-check.sh` | 全仓+studio 零引用（仅互指） | 无调用方 | 高 |
| D10 | 死导出 `getConstraintsMeta`（constraints-retire.ts:50 未用 import） | `tsc` TS6133 | 无 | 高（一行） |

### 优化候选（有消费者但存在缺陷 / 漂移 / 浪费）

| # | 目标 | 证据 | 影响面 | 置信度 |
|---|---|---|---|---|
| O1 | `update-user-model` 缺 `--days` 支持（或 studio 调用方修 flag） | 命令仅 `--json`/`--dry-run`（`bin/harness.js:479-480`），studio 传 `--days 1`（`monitor-system-probes.ts:197`）→ unknown option → `|| echo "{}"` | studio 监控探针恒拿空结果 | 高 |
| O2 | CLI 懒加载升级为 per-command require | `bin/harness.js:16-18` 单一 barrel require，`commands/index.ts` re-export 全量 | 任一命令冷启动加载 25 命令 | 高 |
| O3 | 文件遍历继续收敛（`utils/file-walk`） | `spec/annotation-checker.ts:257`、`architecture/cross-project-checker.ts:67`、`tools/loader.ts:155` 等 ~10 处裸递归 | 多处实现 | 中 |
| O4 | `setCustomConfig` 迁移到 per-request 参数后删除 | `checker.ts:145-151` deprecated 但 `check.ts:52` 仍调用 | check 命令 | 高 |
| O5 | `KnowledgeType` 别名统一为 `KnowledgeSubsystem` | `knowledge/types.ts:14-15` deprecated 但 20+ 处内部使用 | knowledge/dashboard/context/cli | 中 |
| O6 | 3 个命令补测试：update-user-model/analyze-sessions/release（~1030 行零测试） | `grep -rln` 无 `.test.ts` 命中 | 三命令 | 高 |
| O7 | package.json 元数据修正（kww→dommaker）+ files 收紧（去 `src`，仅留 dist/bin/templates/docs） | `package.json:41-45,76-83` | npm 包元数据与体积 | 中 |
| O8 | 文档漂移修正：CAPABILITIES.md:32-33 钩子清单、src/index.ts:6-9 旧三层注释、:87-89 空 governance 段、CAPABILITIES.md:4 计数 | 各文件行号 | 文档 | 高 |
| O9 | templates/node-api/node_modules 本地 78M 清理 | `du -sh templates/` = 78M，gitignored 未跟踪 | 本地盘/构建 IO | 中 |
| O10 | `isCapabilityListingFormat` 双轨收敛（删 capabilities-syncer re-export） | `capabilities-syncer.ts:39-42` | sync-docs | 中 |
| O11 | docs/ 与 AGENTS.md 纳入版本控制（ADR-0001 + 研究文档零跟踪；npm 排除改用 files 白名单而非 gitignore） | `.gitignore:29-33`；`git ls-files docs/` 为空、`git ls-files AGENTS.md` 空；CLAUDE.md:125 引用 docs/adr/ | 治理/审计追溯（ADR 决策链、研究基线不可 git 回溯） | 高 |

### 重构候选（结构 / 边界 / 命名债务，需设计）

| # | 目标 | 证据 | 影响面 | 置信度 |
|---|---|---|---|---|
| R1 | exports 边界：studio 经 `require.resolve` 绕过 exports 直取 `dist/gates/command.js`、rule-scanner 硬编码源路径 `src/core/constraints/definitions/` | `provider-hooks.ts:26-28`、`rule-scanner.ts:223`、`package.json:24-52` | gates/constraints 深路径依赖、发布形态 | 高 |
| R2 | 公开 API 面收窄：`src/index.ts` 17 个 `export *` 全量泄漏，孤儿子系统（D1-D7）一旦删即可同步收窄 | `src/index.ts:23-108` | 所有外部 import 面（studio ~40 符号需保留） | 高 |
| R3 | `capabilities-syncer` 与 `core/constraints/capabilities-parser` 职责重叠（计数/解析双实现） | `capabilities-syncer.ts:12,42` vs `capabilities-parser.ts:78` | sync-docs + capability_sync checker | 中 |
| R4 | context 子系统 10 文件仅 2 个活消费（session-manager/knowledge-injector），其余 6 文件为「Phase 2 token 流水线」前瞻未接线 | `context/` 各文件 0 引用 | context 子路径导出 | 中 |
| R5 | gates 6 门禁 CLI + 库双轨：studio 用库（PassesGate/CommandGate）而 CLI 门禁命令（acceptance/performance/security/contract/review）无程序化消费者，产品定位待厘清 | 命令审计表 | 门禁命令去留 | 中 |
| R6 | `bin/harness.js` 591 行命令注册与 `commands/index.ts` 30 行 barrel 的手工同步（新增命令需改两处 + 测试三处） | CLAUDE.md 治理规则「commands/index.ts + bin/harness.js」 | 命令扩展 | 低 |

---

### 附：最重 5 条发现（摘要）

1. **~4800 行无消费代码**集中在 7 个疑似孤儿子系统/子模块（architecture/safety/verification/dashboard/llm + tools 内 registry|loader|core + context 内 6 文件），各有测试拖底但无任何消费者。
2. **studio 唯一程序化调用 update-user-model 的 flag 是错的**（`--days` 不存在），该监控探针恒拿空结果。
3. **architecture 子系统「注册了却永不触发」**：executor 副作用注册但无任何内置约束声明对应 enforcement ID。
4. **CLI 懒加载是半懒**：单 barrel require 使任一命令执行即加载全部 25 命令实现。
5. **studio 经 `require.resolve` + 硬编码 dist/src 路径绕过 package exports 白名单**，深路径依赖脆弱且逼 harness 发布 `src/` 源码。
