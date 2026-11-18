# gates/

## 职责
质量门禁系统：6 种门禁检查（验收/命令/契约/性能/审查/安全）。统一 Gate 三态协议 + 定义↔实现测试闭环 + 声明式生效集（G1）。

## 公共面状态
`./gates` 子路径入口已**整体摘除**（ADR-0038「CLI 可达 ≠ 导出理由」，#199 执行）：全部导出收回后 `index.ts` 空壳一并删除，`package.json` `exports` 不再登记 `./gates`，`src/gates/index.ts` 不存在。本层符号只被本仓 CLI 经实现文件直引消费（如 `cli/commands/command.ts` 直引 `./command`），双仓无编程消费者。下列均为**内部实现符号**，不再是公共面。

## 决策契约（接口契约正本，由本文件承载）
- **deny 单调**：deny 一旦出现即不可被下游 abstain 改回 allow（接口契约）。
- **ask fail-closed**：`ask` 枚举预留、无实现——聚合与命令映射一律按 deny/拦下计（CLI 侧落点是 `cli/gate-command.ts` 的 `gateCommandResult`）。
- **决策浅冻结**：`decisionFromResult` 对决策与内嵌报告 `Object.freeze`，下游不得改写上游决策；改写抛 TypeError（钉在 `__tests__/decision.test.ts`）。

## 核心导出（模块内部，CLI 直引）
- 统一协议：`Gate{id, order, evaluate(ctx)}` → `GateDecision{status: deny|abstain|ask, result: GateResult}`（`types.ts`；`decisionFromResult` 报告→决策映射，浅冻结）。**已知限制**：各实现 `evaluate` 收窄使用专属输入类型，而当前无经本接口多态调 `evaluate` 的生产消费者；TS 方法参数双变意味着若未来新增这种调用，基础 `GateContext` 不会替你校验专属必填字段（如 `CommandGateContext.command`），届时须先收紧接口形状/调用契约
- 定义↔实现闭环：`registry.ts`（定义即注册 + 构建期双向闭环 + 访问口）已删除——三仓零生产消费者，闭环保护不降格、改形状：定义 id 双向对齐、CLI 实现引用可解析、Gate 接口形状由 `__tests__/definitions.test.ts` 断言
- 定义表：`GATE_DEFINITIONS`（`definitions.ts`）——id/description/默认 order/CLI 元数据；CLI 元数据形状即 `CommandDefinition`（ADR-0007：门禁与非门禁共用同一命令定义形状，bin 单引擎单循环；门禁特有语义 = `subcommandStrict:false` 未知子命令落回默认 action + `bareRunsAction:true` 裸跑执行 action）；bin/harness.js 注册表驱动生成 6 门禁命令（纯数据模块，禁 import 实现，保 --help 懒加载；CLI 实现引用为 module+export，per-command 懒加载）
- 生效集（无）：原 `getEffectiveGates` + config.yml `gates.order` / `gates.<id>.enabled` 三重空——无调用方、无任何项目配置过该段、README 无示例且加载器对顶层键名拼错静默通过。`order` 字段保留（链内默认序 + 复开点），裁决理由记在 ADR-0002 文末「后续变更」
- 门禁类：`ReviewGate` / `SecurityGate` / `PerformanceGate` / `ContractGate` / `SpecAcceptanceGate` / `CommandGate`（各自执行细节私有，保留 `check()`/`scan()` 报告方法）；SpecAcceptanceGate 的 runner 输出解读与 e2e 判负都从 `core/validators/test-output.ts` 的 `judgeTestRun` 取（解析收口 ADR-0012、判定依据 ADR-0014，本层既不自带正则也不自写判定 `if`）
- 命令黑名单（`command.ts`）：规则表正本 `DEFAULT_COMMAND_BLACKLIST` 在 `blacklist-rules.ts`（纯数据，自 command.ts 拆出，command.ts re-export 保既有进口；每台 `CommandGate` 实例构造时拷它作基线——运行时扩展点 `addRule()` 已正式放弃，代码已无此方法）。仓内判定不靠模块级单例：CLI `command` 用带配置的那台实例（ADR-0024，`command-gate-dead-options.test.ts` 钉住 CLI 源码零引用 `getCommandGate(`/`getCommandRiskLevel`，hook 恒裸构造，见「约定」）；`DEFAULT_COMMAND_BLACKLIST` 的仓内消费者是 `harness command --list` 的展示。原模块级默认实例出口 `getCommandGate()` / `isCommandAllowed()` / `getCommandRiskLevel()` 已随 #199 删除（双仓零编程消费者）
- `types.ts` — 本层私有类型（Gate / GateContext / 各门禁 Config 与专属输入类型）+ 报告构造器 `pass` / `fail` / `fromError`（动态 passed 走 `gateResult`）：timestamp 与 duration 口径唯一落点，门禁实现禁止手写 GateResult 字面量（duration 是可选字段，漏写无编译期报错）。跨层消费的公共类型（`GateResult` / `GateDecision` / `GateDecisionStatus` / `BlacklistLevel` / `CommandBlacklistRule` / `PerformanceThresholds`）正本在 **`src/types/gate.ts`**（gates 层现代化归拢：cli/gate-command、command/performance 命令与 pretool-use-hook 消费的类型进零依赖公共类型层，本文件 re-export 供层内便捷引用）；旧格式 `AcceptanceCriteria` 与死配置 `customAcceptanceCriteria`（门禁从不读取）已删。**`GateContext` 只带全部门禁真正共享的运行信息（`projectPath` / `taskId` / `runEnv`）**——各门禁专属输入字段在专属输入类型（`ReviewGateContext.prNumber` / `SecurityGateContext.securityScanCommand` / `PerformanceGateContext.performanceThresholds` / `ContractGateContext.oldContractPath|newContractPath` / `CommandGateContext.command`（必填）/ `AcceptanceGateContext.tasksPath`），各 `evaluate()` 收窄收自己的类型，统一 `evaluate → GateDecision` 协议不变；配置一律走构造器（`ReviewGateConfig` 等）——曾与构造器平行、填了不生效的配置型字段已删。机器可检：`__tests__/gate-context-narrowing.test.ts`（编译期钉 + 源码闸 + 行为钉）
- 便捷工厂函数：仅 `createCommandGate`（`command.ts`，CLI 直引）；原 createReviewGate / createSecurityGate / createPerformanceGate / createContractGate 随 `./gates` 入口清空删除

## 依赖关系
- 值依赖：`src/utils/`（exec / guards / error / yaml / numeric-flag）、`src/core/validators/test-output`（`judgeTestRun`，SpecAcceptanceGate 消费——解析收口见「核心导出」）
- type-only：`src/types/`（公共门禁类型正本 `src/types/gate.ts` 与 `types/command-definition`，见「核心导出」）、`src/core/constraints/run-env`（`RunEnv`）

## 约定
- 新门禁必须：① 在 `definitions.ts` 补 GateDefinition（含 CLI 元数据）② 在 `__tests__/definitions.test.ts` 的 IMPLEMENTATIONS 补实现类实例（定义↔实现闭环由该测试断言，缺一即红）③ 实现统一 Gate 接口（evaluate 产三态决策，报告由 `types.ts` 的 `pass`/`fail`/`fromError`/`gateResult` 构造，不手写字面量）④ 配 CLI 命令（命令实现文件 + CLI 元数据的 module+export 引用，bin 由定义表驱动生成，不再手写块）+ 测试文件
- deny 单调是接口契约：决策浅冻结，下游不得改写上游决策
- **统一接口 `evaluate()` 的生产消费者 = 6 个门禁 CLI 命令**：命令一律穿过 `evaluate()`，`GateDecision → CommandResult` 的映射与失败措辞收在 `src/cli/gate-command.ts` 一处（此前是 6 份 `<id> gate denied` + 4 份 `<id> gate error` 各写一遍）。报告面 `check()`/`scan()` 仍是各门禁私有实现，只展示不判断的子命令（`security audit` 等）直读它；例外：`security secrets` 不经 SecurityGate，直跑 gitleaks（命令包外部二进制、缺失 skip 的口径与门禁 evaluate 语义不同，见 cli/commands/CONTEXT.md）
- Gate **链**执行器 `runGates` 已删除（链级无生产调用方：6 个命令各跑一项，下游消费方的 completion guards 不 import 本层）；链级聚合语义（deny 单调 / ask fail-closed / 决策浅冻结）以本文件「决策契约」段为正本。#115 的实质裁决（「deny 后短路跳过剩余门禁」类优化在出现真实链消费者前不做——它与「按执行顺序的全部决策」报告契约直接冲突）随函数删除自然失效，不再保留复开点（ADR-0038 决策 2）
- ask 枚举预留：暂无实现，fail-closed 按 deny 计
- **收到的根要传到自己每个 IO/执行点（harness#95）**：门禁只认 `context.projectPath`，内部相对子路径一律锚到它（`SpecAcceptanceGate` 的 tasksPath、`ContractGate` 的 contractPath、e2e/scan 的 `cwd`），禁止「根已传入却又取 cwd」、禁止 `xxxPath: './…'` 相对默认值——否则 `-p` 半失效且表现为假绿（acceptance 的「无 tasks.yml 即跳过」= passed:true）。本层已无保留的 cwd 站点（checker-gate 已删除）。适用域覆盖到 monitoring 侧的落点默认值：约定正本是「相对片段（`DEFAULT_TRACE_FILE`）必须由消费点锚根」，闸 3 的键名后缀由 `Path` 扩到 `Path|File|Log` 并新增 `xxxFile: SOME_CONSTANT` 常量引用臂（本层曾漏检的形状正是它）。约定正本与机器可检的闸见 `src/cli/commands/CONTEXT.md`
- **CommandGate 的匹配语义只有一个落点（ADR-0024）**：谓词 `match`（规则表遍历 + 类别忽略 + 模式测试）与折裁点 `judge`（级别 → 三桶 + `allowed` + `riskLevel`），`check()` / `isAllowed()` / `getRiskLevel()` 是这份裁决的三个投影——禁止在投影里再写匹配循环。`match` 原为私有，现为公共同步只读面：pretool-use-hook 需要命中明细（rule id/level）写审计 trace，`isAllowed` 的布尔投影丢掉了 hits；谓词语义不变，调用方不得改返回数组。等级取命中集合里的最高档而非首条命中，不变式「存在阻断级命中 ⟺ `check` 不通过 ⟺ `isAllowed` false ⟺ 等级 high」由 `__tests__/command-single-predicate.test.ts` 的源形状闸（`pattern.test(` / `ignoreCategories.includes(` / 遍历规则表的循环体各恰好一处）+ 三投影一致性闸钉住
- **hook 只用出厂规则（裁决，不是疏漏）**：`src/pretool-use-hook.ts` 恒裸构造 `new CommandGate()`，不装项目配置——hook 是 fail-open 的纵深防御一道，阻断级之外的命中同样放行（`isAllowed` 只看阻断级）；配置装载只属于 CLI 侧（`harness command`，判定与 `--level` 共用它创建的那台实例）。两条入口是同一决策模块的两个 adapter，不得在 hook 路径另起一套判定

## 注意事项
- 「门禁」仅指本层注册的 6 种；检查点（`core/validators/checkpoint.ts` + `harness validate` + checkpoints.yml）是独立机制，两者分工与术语裁决见 ADR-0036
- **e2e 执行信任边界（D1）**：`e2eTestCommand` 是可信配置，只在门禁内经 `tokenizeCommand`（shell 词法子集：未引用空白分词、`'...'` 全字面、`"..."` 成组且仅 `\"`/`\\` 转义、其余位置 `\` 转义下一字符、引号未闭合即抛错）解析成 argv 前缀；tasks.yml 的 `e2e_test` / `test_name` 是**不可信数据**，只作为 argv 数组元素追加，经 `execFileAsync`（不经 shell）执行——特殊字符（空白、引号、`$`、反引号、`;`、命令替换形状）只可能成为对应单个参数的字面内容，不触发 shell 解释、不被拆词，也永不进入命令串。判定语义不变：cwd=projectPath、e2eTestTimeout 超时、非零退出/超时判负、退出码 0 时 stdout+stderr 经 `judgeTestRun` 文本交叉否决（只能否决）
- 门禁系统不包含业务逻辑，只提供检查能力
- `acceptance.ts` 的报告面是 `AcceptanceGateResult`（无 gate/duration 字段，`evaluate()` 归一化为 GateResult 报告——设计如此，见该方法注释），不是 GateResult 字面量，故不套 `pass`/`fail` 构造器；改成 GateResult 会动类型形状。tasks.yml 解析（`parseTasksFile` 与 AcceptanceCondition/TaskDefinition/TasksFile 类型）正本在 `tasks-file.ts`（包内私有，不挂 re-export）——D5 起唯一消费方是 SpecAcceptanceGate 与 CLI `acceptance list` 两个入口：同一份合法文件 gate 接受的任务与验收条件 list 列出相同内容，非法 YAML/顶层形状/任务/验收条件在两入口一致 fail-fast（gate 抛出、CLI 侧收口为 kind:fail 退出 1）。验收条件只认新契约 `acceptance`（旧逐条勾选格式已删）：`checked: true` → 满足；未勾选带 `e2e_test` → 跑 E2E 按测试结论判定；未勾选且无 `e2e_test` → 判负（不静默放过）
- **fail-fast 口径（gates 层现代化）**：门禁不再吞错拼兜底——tasks.yml / gh / npm audit / 契约文件的解析或读取失败，要么直接抛出（CLI 侧由 `reportGateError` 收口为命令失败），要么走 `fromError` 的 deny 报告；`catch (error: any)` 与 `as any` 已清零。SecurityGate 的「JSON 解析失败用正则抠数字」文本兜底、ContractGate 的「读不到旧契约当零破坏性变更」吞错分支均已删除。SecurityGate 只把带 `vulnerabilities` 对象的 JSON 视为有效扫描报告（空对象才是有效零漏洞），缺键及扫描器错误报告均走 deny
- 统一的是决策协议（id/order/三态），执行细节（gh pr view/正则黑名单/OpenAPI diff/json-summary 覆盖率）私有——不要把执行细节塞进 Gate 接口
- `PerformanceGate` 只执法有真实现的维度（coverage 走 json-summary、bundleSize 走 dist 测量）；responseTime/memoryUsage/throughput 三维无真实现（原 Math.random 伪造 + 未接线的 runBenchmark）已随 benchmark 机制整体删除（ADR-0018）。覆盖率测试非零退出或超时不读取报告，按既有 warnings 口径标记覆盖率不可用；只有成功执行后才读取本次 json-summary。**覆盖率报告与本次运行绑定（D4）**：运行前把既有 `coverage/coverage-summary.json` 挪作同目录备份，成功后只认「本次重新出现」的报告（首次生成、同内容重写、内容刷新都由此获得本次运行身份，不靠内容比较或耗时断言）；失败/超时/成功但未生成/损坏时恢复备份，既不读取旧报告也不销毁用户既有文件。`readCoverageSummaryPct` 取数正本语义不变（缺失/损坏/字段缺失抛出，归 warnings 口径）
- CommandGate 为命令黑名单检查(SEC-006)
- `SecurityGate` 的扫描命令是**三级优先级**（`scan()` 内 `??` 链，自上而下取第一个已提供值）：① `context.securityScanCommand` ② 构造时传入的 `scanCommand` ③ `detectScanCommand()` 自动探测（现为常量 `npm audit --json --registry https://registry.npmjs.org/`——默认审计固定可信 registry（D4）：命令行 `--registry` 旗标优先于项目 .npmrc 的 registry 配置，项目 npm 配置不能改变默认审计来源；仅缺省探测路径带此旗标，显式可信输入原样下发不追加）。缺省「未提供」的唯一表示是 `undefined`——构造器把 `''` 归一成 `undefined`（`getConfig()`/`this.config` 因此是 `SecurityGateConfig` 而非 `Required<…>`，`scanCommand` 保持可选）；曾因兜成空串令 `??` 链恒停在第二级、第三级探测不可达（`harness security` 不带 `--scan-command` 必抛 `The argument 'file' cannot be empty`）。按包管理器探测（读 lock 选 pnpm/yarn）另开票，本层不改 `detectScanCommand` 常量返回；`auditDetails` 的吞错已随 CLI 包装统一收口 `reportGateError`（gates 层现代化）
