# cli/commands/

## 职责
CLI 子命令实现：21 个顶层命令 + constraints 治理子命令 report/retire，覆盖约束检查/门禁验证/文档同步/知识管理/失败诊断/发布等。

H5（#44）起：
- **命令定义即注册**：`definitions.ts` 的 `COMMAND_DEFINITIONS` 是命令形状（名称/别名/位置参数/选项/子命令/实现引用）的单一来源；bin/harness.js 遍历本表注册表驱动生成，不再手写 commander 命令块，不再有 index.ts barrel 两处同步（R6）
- **per-command 懒加载**（O2）：定义表存实现引用 `{ module, export }`，bin 只在 action 执行时 require 对应命令模块，任一命令执行不再加载全部命令实现

## 核心导出
- `COMMAND_DEFINITIONS`（definitions.ts）— 全部非门禁命令定义（纯数据模块、零闭包，禁止 import 命令实现；ADR-0010）
- 命令契约（`src/cli/command-contract.ts`，上层目录）— `CommandResult` / `CommandKind` / `CommandIO` / `processIO` / `captureIO` / `lastJsonOutput` / `log` / `logError`
- 门禁命令共享面（`src/cli/gate-command.ts`，上层目录）— `GateDecision → CommandResult` 的唯一映射 `gateCommandResult`，加 ✓/✗ 输出骨架 `reportGateDecision` 与出错横幅 `reportGateError`。同一句失败措辞此前抄在 6 个 handler 里（「`<id>` gate denied」×6 / 「`<id>` gate error」×4），门禁特有的指标行经 `onPass`/`onFail` 闭包传入（架构评审候选1）
- 脚手架落盘面（`src/cli/commands/scaffold.ts`）— 受管文件（managed file）三态判定 `writeManagedFile` / 一组落盘 `runPlan` + 8 个站点工厂（含对外文案）；模板正文住 `scaffold-templates.ts`，落盘注入面 `ScaffoldFileSystem` 可换内存替身（harness#132）
- knowledge 投影面（`src/cli/commands/knowledge-view.ts`）— 11 个 knowledge 子操作的**display model** 渲染与出口：`emitKnowledgeView`（json/人读唯一分派 + 退出码）、`announce`（取数期进度行，`--json` 下静默）、`TONE_STYLES` 角色→样式单表、维度/规则 label 与 `toneForMaturity`/`toneForScore`/`toneForSeverity` 三张映射、`resolveKnowledgeBaseDir` + `openKnowledgeStore`（路径兜底与 store 构造单点）（harness#133）
- 各命令文件：check / validate / passes-gate / init / report / status / spec / sync-docs / knowledge / sdd / failure / posteval-plan / release / constraints / spec-baseline-check
- 6 门禁命令实现在 `acceptance` / `command` / `contract` / `performance` / `review` / `security`（其 CLI 元数据在 `src/gates/definitions.ts`，形状同为 `CommandDefinition`，ADR-0007）；**判定一律穿过统一接口 `evaluate()`**，成败与措辞由共享面映射。`command` 只复用映射、保留自己的单行 ✓/✗ 输出（已对外的机器友好形状）；`security audit` / `acceptance list` / `contract validate-schema` / `review status` / `command --list/--level` 是只展示不判断的子命令，直读报告面（`scan()` 等），不套骨架

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
- **数据已在手就不再构造带 IO 副作用的实例（ADR-0020）**：`status` 按 projectPath 直读出 traces 后，直调 `monitoring/trace-analyzer` 的模块级纯函数 `summarizeTraces()`/`detectTraceAnomalies()`，不再 `new TraceCollector({traceFile})` + `new TraceAnalyzer(c)`——collector 构造函数带 mkdir 副作用，而这条路径上它的读方法从未被调用，实例纯属构造仪式。机器可检：`__tests__/status-analysis-wiring.test.ts`（源形状闸：命令体不得出现 `new TraceCollector`/`new TraceAnalyzer`，也不 import `monitoring/traces`）
- **projectPath 只在入口兜底一次，并传到每个 IO/执行点（harness#95）**：`-p/--project-path` 的 cwd 兜底唯一落点是命令模块入口（`const projectPath = options.projectPath || process.cwd()`）；往下每层只能收参数，**禁止再取一次 `process.cwd()`、也禁止用相对路径默认值**——两者都让 `-p` 半失效：执行/读写位置悄悄回到调用方 cwd，而 acceptance 的「无 tasks.yml 即跳过」本身就是 `passed:true`，于是失效表现为假绿。落地形状：执行/IO 根用**必传形参**表达（`PassesGate.runTests(workDir)`），门禁内的相对子路径锚到 projectPath：`ContractGate` 一直是 `path.join(context.projectPath, contractPath)`，`SpecAcceptanceGate` 的 tasksPath 随 #95 对齐成 `path.resolve(projectPath, 相对值)`（绝对值原样，缺省 `<projectPath>/tasks.yml`）
  - 机器可检：`__tests__/project-path-convention.test.ts` 三道闸——CLI 层 cwd 必须是 `xxx || process.cwd()` 兜底形状、下游层（= src 减 cli）cwd 站点**逐行**冻结（#98，豁免文件内新增行/行变形同样失败）、相对路径默认值冻结（#98 收紧：`xxxPath: '相对值'` 对象字面量之外，参数默认值形/模板字面量/双引号形同罪，扫描域 = 整个下游层）；豁免逐条带理由，站点消失却不删条目同样失败
  - 行为可检：`__tests__/project-path-anchoring.test.ts` 前提统一 **cwd ≠ projectPath**、不 mock 任何 IO，断言测试真在 B 执行、证据落 `B/.harness/evidence/`、acceptance 读 `B/tasks.yml`。「根已传入却又取 cwd」这类静态看不出的漂移由它守，冻结表守的是不再新增站点
- **读到部分结果必须告知（harness#100）**：命令面以 `skip` 策略读 JSONL（traces.log / failures.log）时，坏行计数要到用户可见输出，**不允许默默丢弃**。共同约束：无损坏零噪声（计数为 0 不出行）、不改任何既有计数口径（`status` 的 `记录数` 仍是原始非空行数，逐字节不变）、计数一律取自 `src/utils/jsonl` 读链返回的 `skippedLines`（经报告入口透传或在读点就地取用），**禁止**用「原始行数 − 统计条数」反推（窗过滤掉的合法行与坏行分不开）。三处落点各自对得上一行代码：
  - `status`：告知**走 stderr**（`logError(io, …)`），因为 stdout 是报告体、其字节已被 `记录数` 那一行定死，挤进去等于改输出
  - `constraints report`：提示属于**报告体内的降级位**，与既有的 `traceFileExists` 说明同在 stdout；结构化面另两份——`--json` 的 `skippedLines` 字段、`--export` markdown 的警示行（只报条数，不报路径与坏行内容）
  - `constraints retire`：两条路径都**走 stderr**——交互模式在候选列表前一行（沿用本函数既有的 console 例外，`console.error`），`--yes` 直达分支在落盘前 `logError(io, …)`（`retireConstraint` 本身按契约「纯执行无交互」不打印）
  - 原则正本与逐点去向见 `src/monitoring/CONTEXT.md`「约定」段；机器可检面是 `src/utils/__tests__/jsonl-skip-disposition.test.ts`（冻结全仓 skip 读点集合 + 要求每个读点记名声明 `计数去向：`）

## 注意事项
- 新增命令需同步更新 CLAUDE.md / CAPABILITIES.md / src/CONTEXT.md
- **scaffold 三态模型（harness#132 已落地）**：init/validate 的「目标在不在场→写或告知」判定（8 站点 = init 6 + validate 2）收口为 scaffold 模块。术语：**managed file**（受管文件）= harness 模板拥有正本、用户可持有的落盘文件；三态 = `created`（不在场→落盘）/ `exists`（在场→告知跳过，**不细分内容是否等于模板**，内容比较是独立特性）/ `manual`（在场→打印片段请用户手工合并）。纪律：scaffold 不持有覆盖/跳过策略（`--no-git-hooks`/`--no-github-actions` 由命令层翻成 plan 列表，scaffold 只见 plan）；模板留代码内住 `scaffold-templates.ts`，不落 `templates/`（其无运行时消费者、integrity 清单不覆盖）；**打印给用户的片段必须是落盘正文的一部分**（GH Actions 站点冲突分支打印完整 workflow 全文而非 job 片段，#103 判据）；CLAUDE.md/AGENTS.md 标记化幂等写（读-改-写形状）不纳入 scaffold；死选项 `-t/--type` 已随本票删除。GitLab CI 接线决议见下条；pre-push hook 为已知缺口，另开票
  - 8 站点的落点：`scaffold.ts` 存 8 个 `ManagedFile` 工厂（目标路径 + 三态文案 + 冲突片段），`init.ts` 只留「前置告知（无 .git / 目录不在场 / 已有 workflow 覆盖治理命令）+ runPlan」；原住 `validate.ts` 的 `createExampleCheckpoint`/`createExampleResolutions` 随工厂迁入 scaffold，`init.ts` 对 `validate` 的反向 import 因此消失，`validate.ts` 反向消费 `scaffold-templates` 的检查点文件路径约定。新增受管文件 = 一个工厂 + 一条 plan
  - 可检面：`__tests__/scaffold.test.ts`（注入内存 fs 替身，零真实文件系统测全三态 + 8 站点文案逐字冻结 + 同源闸及其反证探针）、`__tests__/init-ondisk.test.ts`（临时目录真跑 init：第一遍逐字节断言落盘内容并对齐改造前的整屏输出，第二遍断言 8 站点第三态与「打印即磁盘正文」）
- **CI 平台维度（harness#143 grilling 落定，待实施）**：init 的 CI 接线加平台维度。术语：**CI 平台（ci platform）** = 服务端门禁的接线目标（`github` / `gitlab` / `none`），一次平台选择贯通三个面（harness-check workflow、governance workflow、`--print-snippets`）。决议：① 显式 `--ci <github|gitlab|none>`，默认 github，**不做 remote 自动检测**（init 常跑在首次 push 前，无 remote 可测；检测错误是静默写错文件）；② 最小参数化——CI 站点工厂收 platform 参数，GitLab 模板进 `scaffold-templates.ts`，第三平台出现前不建注册表抽象；③ 平台选择持久化到 `.harness/config.yml` 的 `ci.platform`（缺省即 github，旧配置零迁移），解析链 = flag > config > github，`--print-snippets` 走同一解析链；④ `--no-github-actions` 保留为 `--ci none` 别名 + deprecation warning，与 `--ci <非none>` 冲突时报错退出；⑤ `.gitlab-ci.yml` 三态：不在场 → `created`，在场 → `manual`（打印 GitLab job 片段请用户合并，同 GH 侧「打印即落盘正文一部分」判据）；⑥ GitLab 模板与 GH 版对仗（同三条命令），用 `rules:` 不用 `only:`，触发 = MR + main/master 分支 push，不加缓存（GH 版也没有，要加另开票两家一起）；治理 workflow 的 `sync-docs --check` 非阻断对应 `allow_failure: true`
- **knowledge view 收口模型（harness#133 已落地）**：knowledge 11 个子操作的「取数 + json 投影 + 人读排版 + 退出码」四件事拆开——命令模块只产 `{ data, human() }`（`data` 是 `--json` 正文的唯一正本，11 个 `knowledgeXxxView` 具名导出即投影本体），`knowledge-view.ts` 收口排版渲染、上色、label 映射、json/人读分派与退出码、路径解析与 store 构造。术语：**display model** = `human()` 返回的结构化人读视图 `{ sections: [{ title, rows: [{ cells }] }] }`，一格（cell）三选一：`label`（纯文案）/ `field`（点分路径声明它投影自 json 面哪个字段，数组下标与 `.length` 合法）/ `derived`（json 面没有的派生量，须在测试豁免表登记理由）。空行是显式的一行（`blankLine()`），不再靠 `\n` 前后缀藏排版。颜色只经 `DisplayTone` 角色查 `TONE_STYLES` 一张表，命令侧零 `chalk` 调用。可检面：`__tests__/knowledge-view.test.ts`（四道闸：源形状 / 11·11 json 字段清单冻结 / 两投影一致性 + 派生量双向对撞 / 满态与空态人读逐行冻结，基线取自改造前实现实测捕获）。
  - **json 面现状冻结**：11 个顶层形状逐字不动（双仓核实 `knowledge --json` 零程序化消费者，studio 走 library 直调；统一包壳是纯 churn，删除 `--json` 死面按 ADR-0022 口径另票评估）。三处有意偏离，均不改字段集合：① `snapshot`/`index` 的 `--json` 由单行紧凑改为两空格缩进（分派单点化的直接结果，与其余 9 个子操作同形）；② `sync-rag` 的两个空态此前把人类文案直接打到 `--json` 的 stdout（吐出的不是 JSON），现由 display model 承担，json 面恒为 `{directory, files}`；③ `stats` 人读面 `verified` 成熟度的颜色随 `toneForMaturity` 单表变为青色（此前 list 青 / stats 黄两处手抄不一致，文字不变）。
  - 与 #134（KnowledgeAudit 收 store）独立落地，唯一交点 `knowledgeAudit` 命令函数，后到者适配。审计后重建索引「只在人读路径发生」是本票保留的既有策略（`--json` 不写盘），也是 `knowledge.ts` 内被逐行冻结的唯一 `options.json` 分支。
- init 治理约束段写入落点（studio #302，ADR 2026-08-21 落点模型）：新仓 → AGENTS.md `PRESERVE:governance` 段（sync-docs 重新生成时保留）；旧模型仓（CLAUDE.md 已有 HARNESS_CONSTRAINTS 标记或 `## Governance Rules` 块）→ 续写 CLAUDE.md，幂等重跑不制造双份正本。治理段「在场守护」由 core 侧 governance_presence checker 承担（段缺失/为空时 check 报警）
- PRESERVE:governance 段内写入纪律：机器管理的只有 HARNESS_CONSTRAINTS 标记区间——有标记只换标记区间，无标记（纯手写段）在段尾追加注入段；段内其余手写内容（治理契约引言/流程/纪律等）必须原样保留（曾整段替换清空手写内容的回归，init-injection.test 有防回归用例）
- 注入段落点路由与 marker-range 替换收口在 `core/constraints/injection-writer`（ADR-0011）：读侧 `resolveInjectionTarget`（漂移检测/retire 同步共用「CLAUDE.md 有标记优先，否则 AGENTS.md」）+ 写侧 `resolveGovernanceLanding`（init 落点选择）；init 三个治理段 writer 与 retire 注入同步均为「渲染 body + 调 writer」，半标记（单边/乱序）一律拒写告警；未注入 = 两处均无完整标记段
- knowledge 命令包含 11 个子操作（list/search/import/decay/stats/sync-rag/audit/snapshot/migrate/index/health）；upsert/sync-status 已迁至 studio CLI（harness#110，二者硬编码 localhost Studio 内部端点，不属 harness「通用框架、文件驱动」定位）
- `stats` / `health` 的飞轮数字不在 CLI 内计算：分子口径唯一实现是 `knowledge/flywheel-metrics.ts`（`evaluateFlywheel`，ADR-0013），本层只做百分比取整/一位小数与字段名映射；`.consumption-stats.json` 的读取留在各命令（module 零 IO）
- 特殊路由（选项条件、子命令兜底、裸跑语义）表达在定义表的 optionRoutes / subcommands / subcommandStrict / bareRunsAction 字段，bin 是纯通用引擎、不含单命令知识
- **命令 interface = `CommandResult` + 注入 io（架构评审候选7）**：命令实现一律声明 `Promise<CommandResult>`（判别联合 `ok|skip|fail|usage-error`，`fail`/`usage-error` 必附可定位的 `reason`，多闸门命令 reason 含 `gate <id>`），末位可选形参 `io: CommandIO = processIO`；类型与写入面在 `src/cli/command-contract.ts`
- **本目录零 `process.exit` / `process.exitCode`**：kind → 退出码的唯一映射在 `bin/harness.js`（`ok`/`skip` → 0，`fail`/`usage-error` → 1，未知 kind fail-closed）。历史上两处条件式（`command --level` 按严重级、门禁按 passed）已由命令侧译成 kind；`sync-docs --check` 的漂移改由实现返回 `fail`（定义表的 `afterRun` 逃生门随之废除）
- **输出不得直接用 console**：流式打印走 `log(io, …)` / `logError(io, …)`（`util.format` + 换行，与 console 逐字节等价，见 `src/cli/__tests__/command-contract.test.ts`）；测试断言输出用 `captureIO()`，不再 `spyOn(process, 'exit')`；`--json` 输出断言用 `lastJsonOutput(io)`（JSON.parse 正本，harness#108）。例外：`constraints retire` 交互正文仍走 console（其 `RetireIO` 只注入 readline 流），退役结果打印已接注入流
- **#95 同型扫荡结论**：两门禁站点已修（`passes-gate` 执行/证据落 projectPath、`acceptance` 去掉 `tasksPath: './tasks.yml'` 相对默认值）。逐点判定后的豁免四处，理由与站点原文一起冻结在 `__tests__/project-path-convention.test.ts` 的豁免表：`release` 的 `pkgPath`（定义表本无 `-p`，pkgPath 就是该命令唯一的根且已逐个传给每条 `run(cmd, pkgPath)`，不构成半失效；给发布流水线新增 `-p` 属新能力）、`command` 的 `evaluate({ projectPath: process.cwd(), … })`（`CommandGate` 只做命令串正则判定、零文件读写，且该命令定义表里没有 `-p`，取 cwd 仅为满足 `GateContext` 形状，架构评审候选1）、`constraints` 的 `join(process.cwd(), 'package.json')`（报的是 harness 自身包版本，主锚 `__dirname`，cwd 仅兜底）、`core/spec/validator.ts` 的 `schemaPath: './specs/schemas'`（**确是同型病灶**：`validateAll(projectPath)` 用 projectPath 找 spec 文件、却用 cwd 找 schema；但 `validateFile`/`loadSchema` 签名里没有根，补齐要穿透整个 spec 域，留待 spec 单票收口）
