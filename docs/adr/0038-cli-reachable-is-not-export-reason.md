# ADR-0038: CLI 可达 ≠ 导出理由——公共面复评第三轮（#199）

- 日期：2026-09-29
- 状态：已接受
- 影响版本：下个 minor（breaking 按 ADR-0022 先例随 minor 发布，见决策 5）
- 关联：harness#199（公共面复评第三轮）；ADR-0003（公共导出显式清单）；ADR-0022（零消费者公共面收缩判据 + TokenBudget「另案评估」出处 + breaking 随 minor 先例）；ADR-0030（记名保留出口的对照例）；harness#115（runGates「参考实现」定位与不做短路优化裁决）；harness#142（ContextTracker 消费边核对）；studio#659（CSOValidator 端点存废前置票）；gates/CONTEXT.md「决策契约」（deny 单调 / ask fail-closed / 决策浅冻结的契约正本）

## 背景

公共面复评第三轮对 `package.json` exports 五个入口（`.` / `./core` / `./presets` / `./context` / `./gates`）的全部导出符号做双仓消费核查。本轮新立的判据一句话：**「CLI 可达 ≠ 导出理由」——导出只对编程消费者存在**。一个符号只被本仓 CLI 经内部路径消费，不构成它挂在公共入口上的理由；公共导出面向的是 import 它的代码，不是能跑到它的命令。

事实核查（2026-09-29，双仓）：

- studio@1b1ca00 `apps/` + `packages/` 全清单 grep（排除测试与 dist）：本票所有被删/被收回符号**零命中**。例外三个有真实消费、必须保留公共导出：`TraceAnalyzer` 类、`TraceCollector` 类、`CheckpointValidator`；`CSOValidator` 本票不动（见决策 4）。
- harness 侧逐符号消费点：A 桶符号双仓无编程消费者且仓内无真实内部接线（真零消费）；B 桶符号只剩「本仓 CLI 经实现文件直引」或库内直引消费，无包外编程消费者。

## 决策

### 两桶裁决

**A 桶（删除桶：删实现 + 删自有测试 + 清 barrel 链 + 清冻结清单 + 清 CONTEXT.md 提及）**——真零消费：

| 符号 | 实况 |
|---|---|
| `TokenBudget` | 双仓零编程消费者；ADR-0022 决策 3 留下的「另案评估」就此结案（决策 3） |
| `ContextTracker`（连 `ContextAverages`/`ContextUsageSnapshot`） | 仓内唯一持有者是 `SessionManager` 的死接线：tracker 从不 `record()`，`getTracker()` 双仓零调用——死接线随类同删 |
| `extractCodeStructure`（连 `CodeStructure`/`DeclarationInfo`/`ImportInfo`） | 仓内零调用方，原是「留给下游的公开面」，下游实测零命中 |
| `runGates` + `GateRunResult` | Gate 链执行器，链级无生产调用方（6 个门禁命令各跑一项）；删除即推翻 #115 的「参考实现」附带定位（决策 2） |
| `getCommandGate` / `isCommandAllowed` / `getCommandRiskLevel` | 模块级默认实例出口；CLI 用带配置的实例、hook 恒裸构造，双仓零编程消费者 |
| `getTraceCollector` / `configureTraceCollector` | cwd 锚定的进程级单例；本仓生产代码自 #139 起零消费，跨仓实测也零命中——「留给跨仓的兼容面」没有消费者 |
| `createAnalyzer` | 工厂函数，等价 `new TraceAnalyzer(new TraceCollector(), config)`；`TraceAnalyzer` 类因 studio 真实消费保留 |

**B 桶（收回桶：实现一律不动，只从公共入口移除导出，内部 import 走实现文件直引）**——只剩 CLI/库内消费：

- `./gates` 入口值面 + 类型面**整体收回**（`decisionFromResult` / `GATE_DEFINITIONS` / 注册表四函数 / `createCheckerGate` / 6 个 Gate 类与 `createCommandGate` / `DEFAULT_COMMAND_BLACKLIST` + 16 个类型）：消费方全是本仓 CLI（`bin/harness.js` 注册表驱动 + 命令实现文件直引）。`src/gates/index.ts` 清空为只余文件头注释；**`./gates` 入口本身保留（package.json 不动），是否摘除 surfaced 给 maintainer 裁决**。
- 包根与 `./core` 收回：`lintEffectiveConfig` + `EffectiveConfigLint`（usage-report 直引）、`CheckCache` + `CheckCacheConfig`/`CheckSamplingConfig`（checker 直引）、`SpecValidator`/`validateSpec`/`validateAllSpecs` + 7 个 spec 类型（CLI `spec` 直引）。
- 包根收回：`migrateKnowledgeEntries`（CLI `knowledge migrate` 直引 `knowledge/migration`）。

### 五裁决

1. **判据立规**：「CLI 可达 ≠ 导出理由，导出只对编程消费者存在」。与 ADR-0030 的记名保留划界：0030 的 usage-report 面有 studio 进程内真实消费者（`generator.ts` named import），本桶符号没有——同是「CLI 也能跑」，有无编程消费者是唯一的分界。
2. **runGates 删除即推翻 #115 的「参考实现」附带定位**：#115 的实质裁决是「deny 后短路跳过剩余门禁」类优化在出现真实链消费者前不做（它与「按执行顺序的全部决策」报告契约直接冲突），该裁决随函数删除自然失效。deny 单调 / ask fail-closed / 决策浅冻结的聚合语义以 `src/gates/CONTEXT.md`「决策契约」段为正本（原住在 runner.ts docstring），CLI 侧落点是 `cli/gate-command.ts` 的 fail-closed 映射。
3. **TokenBudget 删除**：ADR-0022 决策 3「基类虽无实例化点但作为公开基类另案评估」结案——双仓零编程消费者，删。
4. **CSOValidator 本票不动**：前置 studio#659（端点存废）未落地——端点仍在、恒返回 valid（2026-09-29 实测）。端点删除后按本 ADR 同判据删类，记为 follow-up。
5. **发布级别按 ADR-0022 先例：breaking 随 minor**。

### 票面漂移校正（实施前事实核查推翻的票面项）

- `migrateKnowledgeEntries` / `lintEffectiveConfig` / `decisionFromResult` 票面列「删实现」，实测有真实 CLI 或库内消费 → 修正为「收回导出」（B 桶）。
- `ContextTracker` 连 `SessionManager` 死接线同删（票面只提删类）。
- 票面「5 个 Gate 类」实测 6 个（含 `CommandGate`）。
- `TraceAnalyzer` 类因 studio 真实消费保留，仅删 `createAnalyzer` 工厂。
- `createReviewGate`/`createSecurityGate`/`createPerformanceGate`/`createContractGate`/`createSpecAcceptanceGate` 五个便捷工厂是内联在 `gates/index.ts` 的实现（`new X(config)` 等价一行），随入口清空连带删除——等价构造直走类、配置形状不变；`createCommandGate`/`createCheckerGate` 住在实现文件且有库内消费，保留。
- `./gates` 值面类型面全收后入口本身保留， surfaced 给 maintainer。
- 残留候选（`PassesGate`/`createPassesGate`/`createCheckerGate` 实现、`TraceAnalyzerConfig` 等）留待下轮复评。

### 证据摘要（2026-09-29）

- studio@1b1ca00：`apps/` + `packages/`（排除测试/dist）对本票全部删除/收回符号零命中；`TraceAnalyzer`/`TraceCollector`/`CheckpointValidator` 有真实 import。
- harness 侧消费点（B 桶收回后全部走实现文件直引）：`gates/command` ← `cli/commands/command.ts`；`gates/types` ← `cli/gate-command.ts` 等；`knowledge/migration` ← `cli/commands/knowledge.ts`；`core/spec/validator` ← `cli/commands/spec.ts`；`core/effective-constraints` ← `core/constraints/usage-report.ts`；`core/constraints/check-cache` ← `core/constraints/checker.ts`。

## 影响

- 公共面（breaking）：A 桶 7 组符号连实现删除；B 桶包根值面 -36、类型面 -32，`./gates` 值面 24→0、类型面 17→0，`./core` 值面 -3、类型面 -8，`./context` 值面 -1（TokenBudget）、类型面 -1（ContextUsageSnapshot）。三道冻结闸（`public-exports` / `public-type-surface` / `public-value-surface`）以新清单 + `@ts-expect-error` 负钉显式冻结，`./gates` 以空清单冻结（入口保留）。
- 行为：CLI 与库行为零变化（B 桶只动导出，A 桶删的都是无消费者符号）；触及的活代码仅两处：`SessionManager` 删死接线（构造不再实例化从不使用的 tracker）、`gates/index.ts` 五个内联便捷工厂随入口清空删除（`new X(config)` 等价一行，双仓零编程消费者）。
- 文档：gates/CONTEXT.md 新增「决策契约」段承接原 runner.ts docstring 的契约文字；各目录 CONTEXT.md 与 CLAUDE.md 同步；`docs/public-exports-review.md` 等历史快照不回改。
- follow-up：studio#659 落地后按本 ADR 同判据删 `CSOValidator`；`./gates` 空入口摘除与否由 maintainer 裁决；B 桶残留候选下轮复评。
