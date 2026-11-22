# 休眠公共 API 采纳/收回边界调研（harness#215）

> 调研对象：`@dommaker/harness` master @ `7a2642e`（v4.0.2，CHANGELOG [Unreleased] 有 #214 条目）+ `studio` master（依赖 `@dommaker/harness@4.0.2`，主会话已直接 Read 当前 master，全部 studio 现场引用为当前 path:line；历史事实引用 commit SHA + commit message 原文）。
> 方法：包根 exports 显式清单（src/index.ts）+ 全 src 生产/测试调用分离 grep + CHANGELOG/ADR/CONTEXT 一手文档 + git history（含误删/恢复双向）+ GitHub issue/PR（harness#181/#188/#190/#198/#215，studio#657/#658/#640，AS-022）+ GitHub code search 外部消费者 + npm registry 版本核对。所有关键结论带 文件路径:行号。
> 范围：纯调研，未改 exports、实现、测试，未 commit。**明确区分「harness 仓内无生产调用」与「外部无消费者」**——前者是 grep 事实，后者靠消费者登记、文档与实现现状核对推断。
> 版本沿革：2026-11-22 初版（harness 侧单仓调研，studio 事实留白）；同日整合 studio 主会话核查结论并全篇修正——最重要纠偏：**AS-022 不再是挂开的活需求**（§三.10、§五），ingestExternal 分类由「等待消费者」改「可删除候选」。

---

## 一、结论速览（按 #215 要求的四类，已整合 studio 核查）

| 分类 | 符号 | 一句话理由 |
|---|---|---|
| 应立即采纳（harness 侧无活，动作在 studio） | `listRetiredConstraints`（studio#657）、`collectConstraints`（**新开 studio 票**，覆盖两处残缺结果现场）、`disableConstraint`/`packProposal`（含 `collectProposalMaterial`/`renderProposalMarkdown`）/`getConstraintsMeta`（studio#658 三个有效子项，4.0.2 均已具备，**不再等 harness 发版**） | 消费者现场当前仍在、库接口当前版本已可用 |
| 等待消费者（已登记方向，保留） | `retireConstraint`/`reactivateConstraint`（仓内 CLI 主干消费）、检查器原语 SDK `buildCheckEnv`/`normalizeCheckOutcome`/`formatEvidence`（仓内编排层主干 + studio#640 OPEN 方向；studio 当前零调用）、`exec` 执行协议口子（模板注册表闭环 + #640 triage 明确方向；studio 当前无 `checker: exec`） | 有仓内真实消费或开放登记方向，删除判据不满足 |
| 应恢复后由消费者采纳（harness 新实施票，本票不动 exports） | `pruneTraceLogs`、`propagateConfig` + `HARNESS_CONFIG_FILES` | studio 两个真实现场仍在 + #658 的「.harness 布局重新私有」验收仍成立；自管会永久保留跨仓文件布局知识，与 #646/#658 所有权目标冲突；实现可从 71d7bac 取回 |
| 可删除候选（5.0.0，单独实施票；执行前维护者确认） | `KnowledgeIngest.ingestExternal`、`sanitizeExternalContent` | **首次核到需求实现已撤回**（studio 5a982122 删除 external-fetcher）：这不是重复误删，是新事实下的重判；`EXTERNAL_SOURCE_MARKER` 在 studio 仍有活消费，**不在删除范围** |

---

## 二、时间线（一手来源）

| 日期 | 事件 | 来源 |
|---|---|---|
| 2026-06-04 | studio `b0ee0b46`（AS-022 Phase 4）实现 external-fetcher，真实调用 `sharedIngest.ingestExternal`，注释明确 sanitization 由 harness ingestExternal 处理 | studio git history |
| 2026-08-04 | studio `5a982122` **删除 external-fetcher + 测试**，commit message 原文理由：「当前架构无真实需求拉力」「可选入口，带未防护的 SSRF 隐患，现行录入路径不需要」；diff 同时从 knowledge/CONTEXT.md 移除 fetchExternal | studio git history |
| 2026-09-24 | 1.14.0 发布：#181 exec 执行协议口子 + 检查器原语 SDK 导出 | CHANGELOG.md:120 |
| 2026-09-28 | 1.15.0 发布：#188 `listRetiredConstraints` 公共导出 | CHANGELOG.md:112 |
| 2026-09-29 15:22Z | studio#657（retired 清单切 `listRetiredConstraints`）、studio#658（五处偷看切库接口）登记，均 OPEN | gh issue view 657/658 createdAt |
| 2026-09-29 19:11 | #198 合并（71d7bac）：变更面补库接口上公共 barrel——`retireConstraint`/`reactivateConstraint`/`disableConstraint` 自 CLI 搬入 core、`packProposal` 新增返回 `{materialPath, content}`、**新增 `pruneTraceLogs`、`propagateConfig`+`HARNESS_CONFIG_FILES`**、`getConstraintsMeta` 移 core 导出 | CHANGELOG.md:98 |
| 2026-09-30 | 1.16.0 发布（含 #198）；#181 标注「存档触发口径已修正为可排期」 | CHANGELOG.md:95、docs/adr/0035:38 |
| 2026-10-08 | 班次 2 减法（5049325）**误删** `ingestExternal`/`sanitizeExternalContent`；同日 6c7b2dd 恢复 + ADR-0041 追记悬空意图裁决——**恢复前提「AS-022 仍挂开」不完整**：studio 已于 08-04 删除实现（见 §三.10） | git log、ADR-0041 §追记 |
| 2026-10-16 | 4.0.0 发布（45dc88c，ADR-0042 Phase 1）：`pruneTraceLogs`（本体+专测连删）、`propagateConfig`+`HARNESS_CONFIG_FILES`（core/config-files.ts 整文件连删）以「三仓 grep 零生产消费」判据删除——此时 studio#658（OPEN）正点名二者为切换目标 | CHANGELOG.md:47-58（条目在 :54）、docs/adr/0042:17 |
| 2026-11-18 | 4.0.2 发布（npm latest，studio 当前依赖版本）；#214（死字段清理）已合未发 | CHANGELOG.md:13 |
| 2026-11-22 | studio 主会话核查：六处偷看现场**全部仍在**（路径有漂移，§四）；`collectConstraints` 两处自然消费者确认；AS-022 开放需求记录确认已清零 | 本报告 §三/§四 |

---

## 三、逐项符号矩阵

判定口径：**仓内生产调用** = src 内排除 `__tests__` 的值级消费；**登记消费者** = 跨仓 open issue 明确点名的迁移意图（≠已发生的调用）。

### 3.1 `collectConstraints`（独立便捷函数）—— 应立即采纳

- 来源/定义：`src/core/constraints/checker.ts:402-407`（委托 `ConstraintChecker.getInstance().collectConstraints`）；实例方法本体 `:270`。与 `checkConstraints`（`:383`）共享检查体、同一 options 签名，唯一差别不 throw（`:398-401`：「报告类消费者拿全量视图；阻断语义只属于 checkConstraints」）。
- 公开导出：`src/index.ts:117-122`；冻结清单 `src/__tests__/public-exports.test.ts:57`。studio 运行时实测 4.0.2 包根本符号在。
- 仓内生产调用：独立函数零；实例方法有 CLI 消费 `src/cli/commands/report.ts:98`。
- **当前消费者（studio 主会话核实）**：两处自然且当前的消费形态——`apps/api/src/modules/harness/constraints.routes.ts:283-320` 与 `apps/api/src/modules/mcp/safety.tools.ts:29-69` 都调 `checkConstraints` 后捕获 `ConstraintViolationError`，再以 `violationPartialView` 返回**残缺结果**（`sanitize-context.ts:60-82` 明确后续检查未执行）。这正是 `collectConstraints` 不 throw、拿全量视图的设计意图对应的现场。
- 登记票：无（GitHub search 0）。建议**新开一张 studio 实施票**覆盖上述两处，不在 #215 调研票创建。
- 建议分类：**应立即采纳**。复评条件：新票完成；harness 侧保留不动。

### 3.2 `listRetiredConstraints` —— 应立即采纳

- 来源/定义：`src/core/retired-constraints.ts:65`（判定谓词复用同模块 `isRetiredTombstone` :48，纯读无闸门语义）。
- 公开导出：`src/index.ts:50-52` + 类型 :53-56；冻结清单 `public-exports.test.ts:68`。1.15.0 发布（CHANGELOG.md:112，#188）。
- 仓内生产调用：零（生效集过滤走 `isRetiredTombstone` 内部谓词；定义外仅测试）。
- 当前消费者/登记票：**studio#657 现场仍在**——`apps/api/src/modules/harness/constraints.routes.ts:88-99` 直读 config.yml、`:145-154` 过滤 retired（主会话核实当前 master）。
- 建议分类：**应立即采纳**（动作全在 studio；harness 侧零改动）。复评：墓碑读口属约束数据定位核心，#657 完成后仍保留公开读口。

### 3.3 `disableConstraint` / `retireConstraint` / `reactivateConstraint`（约束变更面）

- 来源/定义：`src/core/constraint-lifecycle.ts:391`（disable）、`:232`（retire）、`:332`（reactivate）；#198 自 CLI 搬入 core，签名与状态联合逐字不变（CHANGELOG.md:98）。
- 公开导出：`src/index.ts:65-81`；冻结清单在列。studio 运行时实测包根在。
- 仓内生产调用：**有**——`src/cli/commands/constraints-disable.ts:92`、`constraints-retire.ts:260,301`、`constraints-reactivate.ts:110`。
- 当前消费者/登记票：**studio#658 第 2 处现场仍在**——`apps/api/src/modules/evolution/applier.ts:242-285` 直写 config.yml disable（主会话核实，路径已从票面 215-249 漂移）。
- 建议分类：**disableConstraint = 应立即采纳**（#658 有效子项，4.0.2 已具备，不再等 harness 发版）；**retire/reactivate = 等待消费者**（studio 当前仍分别经 `applier.ts` 与 `constraints.routes.ts` 调 CLI，尚无库切换登记票；harness CLI 主干消费保底）。

### 3.4 `packProposal`（含 `collectProposalMaterial`/`renderProposalMarkdown`）—— 应立即采纳

- 来源/定义：`src/core/constraints/pack-proposal.ts:155`（→ `{ materialPath, content }`，#198 新增）；`:121`、`:58`（不落盘渲染通道）；`proposalMaterialPath`（`:145`，4.0.0 已摘包根导出、本体留模块内，CHANGELOG.md:54 ④）。
- 公开导出：`src/index.ts:82-90`；冻结清单含三符号。studio 运行时实测包根在。
- 仓内生产调用：**有**——`src/cli/commands/constraints-pack-proposal.ts:73`（packProposal）、`:67,:69`（渲染通道）、`pack-proposal.ts:160,164`（内部）。
- 当前消费者/登记票：**studio#658 第 3 处现场仍在**——`apps/api/src/modules/evolution/constraint-adapter.ts:202-230` spawn CLI 后按命名规律猜 pack 产物路径（主会话核实，路径已从票面 217-228 漂移）。
- 建议分类：**应立即采纳**（#658 有效子项）。三导出作为一组，不拆。

### 3.5 `getConstraintsMeta`（约束元数据库面）—— 应立即采纳

- 来源/定义：`src/core/constraints/meta.ts:20`（`constraints --json` 背后的函数）；#198 动机 = 「消费方免起 `constraints --json` 子进程」（CHANGELOG.md:98）。
- 公开导出：`src/index.ts:91-94`；冻结清单在列。studio 运行时实测包根在。
- 仓内生产调用：**有**——`src/cli/commands/constraints.ts:21`、`constraints-report.ts:208`。
- 当前消费者/登记票：**studio#658 第 4 处现场仍在**——`packages/studio-agent/src/services/output-capture.ts:183-205` `execSync` npx `constraints --json` 冻事件循环（主会话核实，路径已从票面 192-195 漂移）。
- 建议分类：**应立即采纳**。#658 五处中 harness 侧动机最硬的一处（消灭 execSync + npx 的唯一替代面）。

### 3.6 `pruneTraceLogs` —— 4.0.0 已删；建议恢复后由 #658 采纳

- 历史：#198 新增（71d7bac，CHANGELOG.md:98「traces GC 独立库入口，缺目录 no-op」）→ 4.0.0（45dc88c，CHANGELOG.md:54 ④）**本体+专测连删**，判据「三仓 grep 零生产消费者」（ADR-0042:17）。studio 运行时实测 4.0.2 包根无此符号。
- 现状：全 src 仅残留 `src/core/constraints/__tests__/context-reconcile.test.ts:182,189-190` 的**合成测试夹具**字符串（虚构 exportSurface 样例，非现状断言）。
- 当前消费者/登记票：**studio#658 第 1 处现场仍在**——`apps/api/src/modules/ops/monitor-lifecycle.ts:202-222` 手删 traces-*.log（主会话核实，路径已从票面 284-304 漂移）。删除时点 #658 已 OPEN 17 天且点名本符号（§五教训）。
- 建议分类：**应恢复后由消费者采纳**。理由：studio 真实现场仍在 + #658 的「`.harness/` 布局重新私有」验收仍成立；自管虽简单，却永久保留跨仓文件布局知识，与 #646/#658 的所有权目标冲突。执行路径：**另开 harness 实施票**，实现从 71d7bac 历史取回；本调研票不改 exports。

### 3.7 `propagateConfig` + `HARNESS_CONFIG_FILES` —— 4.0.0 已删；建议恢复后由 #658 采纳

- 历史：#198 新增（config.yml + checkpoints.yml 铺放单一主人，CHANGELOG.md:98）→ 4.0.0 `core/config-files.ts` **整文件连删**（CHANGELOG.md:54 ④）。git log 确认该文件仅存在于 71d7bac..45dc88c 之间。studio 运行时实测 4.0.2 包根无此符号。
- 当前消费者/登记票：**studio#658 第 5 处现场仍在**——`packages/studio-agent/src/services/worktree-resolver.ts:217-251` 手工 cp config.yml/checkpoints.yml（主会话核实，路径已从票面 195-209 漂移）。与 3.6 同型冲突。
- 建议分类/执行路径：同 3.6（恢复 + #658 采纳，另开 harness 实施票）。

### 3.8 检查器原语 SDK —— 等待消费者（保留）

- 来源/定义：`src/core/constraints/checkers/types.ts:81`（`buildCheckEnv`）、`:174`（`normalizeCheckOutcome`）、`:163`（`formatEvidence`）；#181 + ADR-0035 决策 3 第二半（docs/adr/0035:38），导出纪律 = 「只导出存量，不为想象中的需求新增抽象」。
- 公开导出：`src/index.ts:129-144`；仓内 barrel `src/core/constraints/index.ts:22-24`；冻结清单 `public-exports.test.ts:52`。
- 仓内生产调用：**有，编排层主干**——`src/core/constraints/checker.ts:193`、`:104`；`formatEvidence` 被全部内置 checker 使用（`context-doc-sync.ts:37`、`templated/file-exists.ts:69,80`、`templated/regex-scan.ts:36`、`no-completion-without-verification.ts:86,126`、`capability-sync.ts:100,114`、`docs-freshness.ts:108,144`、`no-test-simplification.ts:101`、`no-hardcoded-credentials.ts:141`、`templated/exec.ts:79`）。
- 当前 studio 消费：**零命中**（主会话核实当前 master 源码）。ADR-0035:5 记的 studio#640 仍 OPEN，是 Phase 2 新能力建设（违规代理计数），**不是已完成接线**。
- 建议分类：**等待消费者**。SDK 面向「业务检查器脚本 import 原语组装」的消费方式天然落在消费方业务仓，仓内看不到调用是设计使然；且有仓内主干消费保底，删除判据不满足。

### 3.9 `exec` 执行协议口子（`execScript` 模板）—— 保留（等待消费者）

- 来源/定义：`src/core/constraints/checkers/templated/exec.ts`（harness#181、ADR-0035 决策 3 exec 档）：按退出码判定、超时杀进程组、输出截断、readOnly 策略三态 skip。
- 公开导出：**不在包根**；经 `TEMPLATES` 注册表暴露给应用层约束（`src/core/constraints/checkers/index.ts:27,61-64`）。
- 当前 studio 消费：**无**——studio 当前 `.harness` 配置/源码无 `checker: exec`（主会话核实）；studio#640 triage 明确 exec 自定义检查器口子暂缓到「首张模板无法表达的提案」。
- 建议分类：**保留注册表口子、等待消费者**。issue 所称「exec checker SDK」即 #181 两半（3.8 + 3.9）。studio#658 的「CLI execSync shim 评估」指向 studio 自有 shim——`apps/api/src/cli/data.ts:166-170` 另有透传 npx shim（主会话核实）——纯 studio 内部事务，harness 侧无对应导出、无动作。

### 3.10 `KnowledgeIngest.ingestExternal` —— 可删除候选（5.0.0，需先纠正需求状态）

- 来源/定义：`src/knowledge/ingest.ts:189-199`（强制 `origin:'external'`、内容先过 sanitize）；随 `KnowledgeIngest` 类经 `src/index.ts:232-242` 公开。
- 仓内生产调用：零（仅 `ingest.test.ts:783-801`）。
- **需求状态核正（本轮最重要纠偏）**：
  - studio `b0ee0b46`（2026-06-04，AS-022 Phase 4）实现 external-fetcher，真实调用 `sharedIngest.ingestExternal`，注释明确 sanitization 由 harness ingestExternal 处理——需求**曾经真实落地**，不是纸面意图。
  - studio `5a982122`（2026-08-04）删除 external-fetcher + 测试，commit message 原文：「当前架构无真实需求拉力」「可选入口，带未防护的 SSRF 隐患，现行录入路径不需要」；diff 同时从 knowledge/CONTEXT.md 移除 fetchExternal。
  - 当前 studio 源码无 external-fetcher/fetchExternal；当前 docs/sdd、legacy-sdd、GitHub issues 均无 AS-022 开放需求记录；只剩 `docs/_archive/obsolete/roadmap.md:534-537` 完成记录；kb-optimize-phase1 requirement frontmatter status=done。
  - **结论**：6c7b2dd（10-08）恢复时引用的「AS-022 仍挂开」前提不完整——studio 08-04 已删除实现，恢复晚于撤回 65 天。ADR-0041 的**流程教训保留**（不能只 grep 调用、要核需求状态），但其**事实前提需更正**：AS-022 不能再作为当前活需求背书。
- 建议分类：**可删除候选**——这是首次核到需求实现已撤回后的新事实重判，**不是重复 5049325 的误删**（当时撤回的 commit 尚未被发现）。执行条件：① 本报告 + ADR-0041 追记更正需求状态；② 5.0.0 major 窗口走 `refactor!:` + CHANGELOG 迁移说明；③ **执行前由维护者确认不再重启外部摄入**（若判断应更保守，维持本分类但加确认闸，不回退为「等待活需求」）；④ 单独实施票，不在 #215 直接删。

### 3.11 `sanitizeExternalContent` —— 可删除候选（与 3.10 同票同判，不可拆）

- 来源/定义：`src/knowledge/ingest.ts:66`（脱注入 + 限长，外部内容三层防御第一层）；与 `ingestExternal` 同删同恢复（5049325 → 6c7b2dd，sanitize 五项测试随恢复取回）。
- 公开导出：`src/index.ts:237`；`src/knowledge/index.ts:34`；冻结清单 `public-exports.test.ts:75`。
- 仓内生产调用：`ingest.ts:193`（`ingestExternal` 内部）+ 测试。
- 需求状态：同 3.10——AS-022 实现已撤回，当前无活消费方。
- **范围外声明**：`EXTERNAL_SOURCE_MARKER`（`src/index.ts:243-249`）在 studio 仍有活消费，**不在删除范围**；原「标准/家具保留公开导出」理由对它依然成立，不随本项重判。
- 建议分类：**可删除候选**，与 `ingestExternal` 同一实施票、同一确认闸，不拆判。

---

## 四、studio#657/#658 关联裁决（已整合 studio 当前 master 核查）

- **#657（retired 清单 → `listRetiredConstraints`）**：现场仍在（`constraints.routes.ts:88-99` 直读、`:145-154` 过滤），无阻塞，**应立即执行**（studio 侧）。
- **#658 五处有效性核对（2026-11-22 studio master 实测）**：
  | #658 现场 | 切换目标 | harness 4.0.2 状态 | 裁决 |
  |---|---|---|---|
  | `ops/monitor-lifecycle.ts:202-222` 手删 traces | `pruneTraceLogs` | **已删（4.0.0）** | 票文失效 → **恢复库接口后采纳**（§3.6） |
  | `evolution/applier.ts:242-285` 直写 disable | `disableConstraint` | 在 | **有效，应立即采纳** |
  | `evolution/constraint-adapter.ts:202-230` 猜产物路径 | `packProposal` | 在 | **有效，应立即采纳** |
  | `studio-agent/.../output-capture.ts:183-205` execSync | `getConstraintsMeta` | 在 | **有效，应立即采纳** |
  | `studio-agent/.../worktree-resolver.ts:217-251` 手工 cp | `propagateConfig` | **已删（4.0.0）** | 票文失效 → **恢复库接口后采纳**（§3.7） |
  | 附：`apps/api/src/cli/data.ts:166-170` 透传 npx shim | —— | harness 无对应导出 | 纯 studio 内部事务 |
- 关键事实：#658 创建于 2026-09-29（#198 合并前 4 小时），**早于 4.0.0 删除 17 天且全程 OPEN**。45dc88c 的复核口径查的是**已发生的生产调用**，不查**已登记的迁移意图**——两个在途目标被删。本次不采「studio 自管」折中：自管会让跨仓文件布局知识永久留在 studio，与 #646/#658 的所有权目标冲突；正解是恢复两个库接口（实现从 71d7bac 取回，另开 harness 实施票）再由 #658 采纳。

## 五、教训与判据边界（本轮登记三条）

1. **ADR-0041 追记判据（既有，流程部分仍有效）**：不能只 grep 调用就删——`ingestExternal` 5049325 → 6c7b2dd 同日删了又恢复是前科。但该恢复的事实前提（AS-022 挂开）本轮被证伪（§3.10），判据保留、事实更正。
2. **本轮新登记——「登记消费者」进删除复核清单**：45dc88c 的「三仓 grep 零生产消费者」漏掉「跨仓 open issue 已点名、尚未执行」的在途迁移（studio#658 两个目标被删即后果）。此后 harness 任何包根导出删除票的复核步骤固定加一项：**gh issue search 跨仓登记意图**（`org:dommaker "@dommaker/harness"` / 符号名），与 grep 并列。
3. **本轮新登记——核「活需求」要核到实现层**：不能只看需求文档仍打开，还要查**实现是否已撤回**、issue/SDD 当前状态。AS-022 文档线索（roadmap 完成记录、status=done）与实现撤回（5a982122）都在，但 6c7b2dd 恢复时只引用了文档侧。核查顺序固定为：文档状态 → issue/SDD 状态 → **消费方实现 git history 是否已删调用**。

## 六、复评窗口与跨仓执行清单

**harness 侧（均不在 #215 本票执行）**：

1. 新实施票：恢复 `pruneTraceLogs` + `propagateConfig`/`HARNESS_CONFIG_FILES`（从 71d7bac 取回，本身无 breaking；但 #214 已开启 major 窗口，实际随 5.0.0 发布）→ 解锁 #658 两个失效子项。
2. 新实施票（5.0.0）：删除 `ingestExternal`/`sanitizeExternalContent`——前置 = ADR-0041 追记更正需求状态 + 维护者确认不重启外部摄入 + CHANGELOG `refactor!:` 迁移说明。
3. 无动作：`collectConstraints`/`listRetiredConstraints`/`disableConstraint`/`packProposal`/`getConstraintsMeta`/SDK/exec 口子全部保留。

**studio 侧（建议，不在本票创建）**：

4. 执行 #657（今天就能做，4.0.2 已具备）。
5. 执行 #658 三个有效子项（4.0.2 已具备，**不再等 harness 发版**）；两个失效子项等 harness 恢复票发布后跟进。
6. 新开一张 `collectConstraints` 实施票：覆盖 `constraints.routes.ts:283-320` 与 `mcp/safety.tools.ts:29-69` 两处「checkConstraints + 捕获 + 残缺视图」，切全量不抛的 `collectConstraints`（顺带消除 `sanitize-context.ts:60-82` 记名的「后续检查未执行」残缺语义）。

## 七、外部消费者核查与局限

- GitHub code search `"@dommaker/harness"` 排除 dommaker/harness、dommaker/studio、dommaker/mcp-local-rag 后 **0 命中**——无公开 GitHub 仓编程消费本包（2026-11-22 复核）。
- 局限：私有仓/未 push 消费者无法穷举；消费方仅 studio 是 ADR-0029/0041/0042 一贯的治理假设。
- 版本通道：npm latest = 4.0.2（2026-11-18）；#214 已开 5.0.0 major 窗口（CHANGELOG [Unreleased]），`ingestExternal` 删除候选随 5.0.0 走 breaking 惯例；`pruneTraceLogs`/`propagateConfig` 恢复是纯新增、无 breaking。

## 八、未决风险

1. **「等待消费者」类的最大风险是消费者永远不来**：检查器原语 SDK 与 exec 口子系于 studio#640 执行；若 #640 长期搁置，复评时降级为「收回公共导出、保留内部实现（仓内编排层在用）」而非删除——ADR-0042 的 `proposalMaterialPath` 先例给了不伤本体的收回形状。
2. **恢复票与 #658 的时序耦合**：#658 两个子项在恢复票发布前无法推进；若恢复票被否（维护者改判 studio 自管），需回 #658 改记并同步本报告 §3.6/§3.7 分类。
3. **ingestExternal 删除的执行闸**：维护者确认「不再重启外部摄入」是硬前置——AS-022 撤回理由（SSRF 隐患、无需求拉力）若被未来外部摄入需求重写，删除候选即失效；确认记录应写进删除实施票。
4. 本报告写于 harness master `7a2642e` + studio master（2026-11-22 核查）；studio 现场行号会随其 master 漂移，再核以符号名为准。
