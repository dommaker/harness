# cli/commands/

## 职责
CLI 子命令实现：23 个顶层命令 + constraints 治理子命令 report/retire，覆盖约束检查/门禁验证/文档同步/知识管理/失败诊断/发布/会话分析等。

H5（#44）起：
- **命令定义即注册**：`definitions.ts` 的 `COMMAND_DEFINITIONS` 是命令形状（名称/别名/位置参数/选项/子命令/实现引用）的单一来源；bin/harness.js 遍历本表注册表驱动生成，不再手写 commander 命令块，不再有 index.ts barrel 两处同步（R6）
- **per-command 懒加载**（O2）：定义表存实现引用 `{ module, export }`，bin 只在 action 执行时 require 对应命令模块，任一命令执行不再加载全部命令实现

## 核心导出
- `COMMAND_DEFINITIONS`（definitions.ts）— 全部非门禁命令定义（纯数据模块、零闭包，禁止 import 命令实现；ADR-0010）
- 命令契约（`src/cli/command-contract.ts`，上层目录）— `CommandResult` / `CommandKind` / `CommandIO` / `processIO` / `captureIO` / `lastJsonOutput` / `log` / `logError`
- 各命令文件：check / validate / passes-gate / init / report / status / spec / sync-docs / knowledge / sdd / failure / posteval-plan / release / analyze-sessions / update-user-model / constraints / spec-baseline-check
- 6 门禁命令实现在 `acceptance` / `command` / `contract` / `performance` / `review` / `security`（其 CLI 元数据在 `src/gates/definitions.ts`，形状同为 `CommandDefinition`，ADR-0007）

`constraints` 下挂治理子命令：`constraints report`（使用统计 + 退役候选诊断 + 配置健康 + 注入漂移，`--export` 脱敏）、`constraints retire`（交互选择 + 人确认退役；带 id 直达需显式 `--yes`（#24 人确认闸门），无 `--yes` 报错 + 非零退出码且不落盘；内置落 config.yml retired 元数据，custom 落 custom-constraints.yml 条目 retired 段（studio#82 D6 一处真相）+ KnowledgeStore 沉淀 + 治理注入段同步）。

## 依赖关系
- 依赖 `src/core/constraints/` 约束引擎
- 依赖 `src/gates/` 门禁系统
- 依赖 `src/monitoring/` 追踪/诊断
- 依赖 `src/knowledge/` 知识引擎
- 依赖 `src/failure/` 失败记录
- 被 `bin/harness.js` CLI 入口按定义表驱动生成

## 约定
- 每个命令一个实现文件，命名与命令名一致（sync-docs 为模块族目录）
- **新增命令 = 命令实现文件 + definitions.ts 一条定义（含 CLI 元数据与实现引用）+ 测试**，不再改 bin/harness.js
- **definitions.ts 是纯数据模块（ADR-0010 后零闭包）**：禁止 import 任何命令实现/运行时依赖（保 --help/--version 懒加载）；子命令别名是数据（条目 `aliases: string[]`，不复印整块），实参编组（缺参闸门/强转/兜底）归各命令模块的具名导出（如 `knowledgeSearchCommand`/`coverageCheck`）；实现引用可解析性由 `__tests__/registry.test.ts` 构建/测试期断言
- 命令选项类型命名规范：XxxOptions
- **本层是上行数据的注入方（harness#88）**：core 对 cli/gates/monitoring 零值导入，故 `check`/`report` 自己 `new ConstraintChecker(getTraceCollector())`（组合根接线 trace 记录器；用 `constraintChecker`/`getInstance()` 拿到的默认实例不写 trace），`sync-docs` 把 `COMMAND_DEFINITIONS` + `GATE_DEFINITIONS` 组装成 `CapabilityDefinitionSource` 注入 `capabilities-parser` 供能力清单计数
- **projectPath 只在入口兜底一次，并传到每个 IO/执行点（harness#95）**：`-p/--project-path` 的 cwd 兜底唯一落点是命令模块入口（`const projectPath = options.projectPath || process.cwd()`）；往下每层只能收参数，**禁止再取一次 `process.cwd()`、也禁止用相对路径默认值**——两者都让 `-p` 半失效：执行/读写位置悄悄回到调用方 cwd，而 acceptance 的「无 tasks.yml 即跳过」本身就是 `passed:true`，于是失效表现为假绿。落地形状：执行/IO 根用**必传形参**表达（`PassesGate.runTests(workDir)`），门禁内的相对子路径锚到 projectPath：`ContractGate` 一直是 `path.join(context.projectPath, contractPath)`，`SpecAcceptanceGate` 的 tasksPath 随 #95 对齐成 `path.resolve(projectPath, 相对值)`（绝对值原样，缺省 `<projectPath>/tasks.yml`）
  - 机器可检：`__tests__/project-path-convention.test.ts` 三道闸——CLI 层 cwd 必须是 `xxx || process.cwd()` 兜底形状、下游层（core/gates/context/monitoring/hooks）cwd 站点集合冻结、`xxxPath: '相对值'` 默认值冻结；豁免逐条带理由，站点消失却不删条目同样失败
  - 行为可检：`__tests__/project-path-anchoring.test.ts` 前提统一 **cwd ≠ projectPath**、不 mock 任何 IO，断言测试真在 B 执行、证据落 `B/.harness/evidence/`、acceptance 读 `B/tasks.yml`。「根已传入却又取 cwd」这类静态看不出的漂移由它守，冻结表守的是不再新增站点
- **读到部分结果必须告知（harness#100）**：命令面以 `skip` 策略读 JSONL（traces.log / failures.log）时，坏行计数要到用户可见输出，**不允许默默丢弃**。共同约束：无损坏零噪声（计数为 0 不出行）、不改任何既有计数口径（`status` 的 `记录数` 仍是原始非空行数，逐字节不变）、计数一律取自 `src/utils/jsonl` 读链返回的 `skippedLines`（经报告入口透传或在读点就地取用），**禁止**用「原始行数 − 统计条数」反推（窗过滤掉的合法行与坏行分不开）。三处落点各自对得上一行代码：
  - `status`：告知**走 stderr**（`logError(io, …)`），因为 stdout 是报告体、其字节已被 `记录数` 那一行定死，挤进去等于改输出
  - `constraints report`：提示属于**报告体内的降级位**，与既有的 `traceFileExists` 说明同在 stdout；结构化面另两份——`--json` 的 `skippedLines` 字段、`--export` markdown 的警示行（只报条数，不报路径与坏行内容）
  - `constraints retire`：两条路径都**走 stderr**——交互模式在候选列表前一行（沿用本函数既有的 console 例外，`console.error`），`--yes` 直达分支在落盘前 `logError(io, …)`（`retireConstraint` 本身按契约「纯执行无交互」不打印）
  - 原则正本与逐点去向见 `src/monitoring/CONTEXT.md`「约定」段；机器可检面是 `src/utils/__tests__/jsonl-skip-disposition.test.ts`（冻结全仓 skip 读点集合 + 要求每个读点记名声明 `计数去向：`）

## 注意事项
- 新增命令需同步更新 CLAUDE.md / CAPABILITIES.md / src/CONTEXT.md
- init 治理约束段写入落点（studio #302，ADR 2026-08-21 落点模型）：新仓 → AGENTS.md `PRESERVE:governance` 段（sync-docs 重新生成时保留）；旧模型仓（CLAUDE.md 已有 HARNESS_CONSTRAINTS 标记或 `## Governance Rules` 块）→ 续写 CLAUDE.md，幂等重跑不制造双份正本。治理段「在场守护」由 core 侧 governance_presence checker 承担（段缺失/为空时 check 报警）
- PRESERVE:governance 段内写入纪律：机器管理的只有 HARNESS_CONSTRAINTS 标记区间——有标记只换标记区间，无标记（纯手写段）在段尾追加注入段；段内其余手写内容（治理契约引言/流程/纪律等）必须原样保留（曾整段替换清空手写内容的回归，init-injection.test 有防回归用例）
- 注入段落点路由与 marker-range 替换收口在 `core/constraints/injection-writer`（ADR-0011）：读侧 `resolveInjectionTarget`（漂移检测/retire 同步共用「CLAUDE.md 有标记优先，否则 AGENTS.md」）+ 写侧 `resolveGovernanceLanding`（init 落点选择）；init 三个治理段 writer 与 retire 注入同步均为「渲染 body + 调 writer」，半标记（单边/乱序）一律拒写告警；未注入 = 两处均无完整标记段
- knowledge 命令包含 11 个子操作（list/search/import/decay/stats/sync-rag/audit/snapshot/migrate/index/health）；upsert/sync-status 已迁至 studio CLI（harness#110，二者硬编码 localhost Studio 内部端点，不属 harness「通用框架、文件驱动」定位）
- `stats` / `health` 的飞轮数字不在 CLI 内计算：分子口径唯一实现是 `knowledge/flywheel-metrics.ts`（`evaluateFlywheel`，ADR-0013），本层只做百分比取整/一位小数与字段名映射；`.consumption-stats.json` 的读取留在各命令（module 零 IO）
- 特殊路由（选项条件、子命令兜底、裸跑语义）表达在定义表的 optionRoutes / subcommands / subcommandStrict / bareRunsAction 字段，bin 是纯通用引擎、不含单命令知识
- **命令 interface = `CommandResult` + 注入 io（架构评审候选7）**：命令实现一律声明 `Promise<CommandResult>`（判别联合 `ok|skip|fail|usage-error`，`fail`/`usage-error` 必附可定位的 `reason`，多闸门命令 reason 含 `gate <id>`），末位可选形参 `io: CommandIO = processIO`；类型与写入面在 `src/cli/command-contract.ts`
- **本目录零 `process.exit` / `process.exitCode`**：kind → 退出码的唯一映射在 `bin/harness.js`（`ok`/`skip` → 0，`fail`/`usage-error` → 1，未知 kind fail-closed）。历史上两处条件式（`command --level` 按严重级、门禁按 passed）已由命令侧译成 kind；`sync-docs --check` 的漂移改由实现返回 `fail`（定义表的 `afterRun` 逃生门随之废除）
- **输出不得直接用 console**：流式打印走 `log(io, …)` / `logError(io, …)`（`util.format` + 换行，与 console 逐字节等价，见 `src/cli/__tests__/command-contract.test.ts`）；测试断言输出用 `captureIO()`，不再 `spyOn(process, 'exit')`；`--json` 输出断言用 `lastJsonOutput(io)`（JSON.parse 正本，harness#108）。例外：`constraints retire` 交互正文仍走 console（其 `RetireIO` 只注入 readline 流），退役结果打印已接注入流
- **#95 同型扫荡结论**：两门禁站点已修（`passes-gate` 执行/证据落 projectPath、`acceptance` 去掉 `tasksPath: './tasks.yml'` 相对默认值）。逐点判定后的豁免三处，理由与站点原文一起冻结在 `__tests__/project-path-convention.test.ts` 的豁免表：`release` 的 `pkgPath`（定义表本无 `-p`，pkgPath 就是该命令唯一的根且已逐个传给每条 `run(cmd, pkgPath)`，不构成半失效；给发布流水线新增 `-p` 属新能力）、`constraints` 的 `join(process.cwd(), 'package.json')`（报的是 harness 自身包版本，主锚 `__dirname`，cwd 仅兜底）、`core/spec/validator.ts` 的 `schemaPath: './specs/schemas'`（**确是同型病灶**：`validateAll(projectPath)` 用 projectPath 找 spec 文件、却用 cwd 找 schema；但 `validateFile`/`loadSchema` 签名里没有根，补齐要穿透整个 spec 域，留待 spec 单票收口）
