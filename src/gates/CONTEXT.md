# gates/

## 职责
质量门禁系统：6 种门禁检查（验收/命令/契约/性能/审查/安全）。统一 Gate 三态协议 + 注册表闭环 + 声明式生效集（G1）。

## 核心导出
- 统一协议：`Gate{id, order, evaluate(ctx)}` → `GateDecision{status: deny|abstain|ask, result: GateResult}`（`types.ts`；`decisionFromResult` 报告→决策映射，浅冻结）
- 注册表：`gateRegistry`（`registry.ts`）——定义即注册 + 构建期双向闭环（定义无实现/实现无定义/重复 id → 加载期抛错）；`getGate`（未注册抛错）/`listRegisteredGates`/`registeredGateCount`；闭环校验本体是 `assertGateRegistryClosed(definitions, implementations)`（本模块加载时对 `GATE_DEFINITIONS` × `IMPLEMENTATIONS` 自跑一次，消费方亦可自带两张表调用）
- 定义表：`GATE_DEFINITIONS`（`definitions.ts`）——id/description/默认 order/CLI 元数据；CLI 元数据形状即 `CommandDefinition`（ADR-0007：门禁与非门禁共用同一命令定义形状，bin 单引擎单循环；门禁特有语义 = `subcommandStrict:false` 未知子命令落回默认 action + `bareRunsAction:true` 裸跑执行 action）；bin/harness.js 注册表驱动生成 6 门禁命令（纯数据模块，禁 import 实现，保 --help 懒加载；CLI 实现引用为 module+export，per-command 懒加载，H5）
- 执行器：`runGates`（`runner.ts`）——按 order 升序；deny 单调（下游 abstain 不得改回 allow）+ ask 枚举预留 fail-closed = deny；决策浅冻结
- 生效集（已删除）：原 `getEffectiveGates` + config.yml `gates.order` / `gates.<id>.enabled` 三重空——无调用方、无任何项目配置过该段、README 无示例且加载器对顶层键名拼错静默通过。`order` 字段与 `runGates` 保留（链内默认序 + 复开点），裁决理由记在 ADR-0002 文末「后续变更」
- checker-as-guard 接线点：`createCheckerGate(check)`（`checker-gate.ts`）——ConstraintCheck → Gate（studio #129 随动）；判定经唯一归一点 `normalizeCheckOutcome`（harness#119/ADR-0016）：`false` 或 `CheckDetail.pass=false` → deny（证据行随理由带出），`true`（含 pass+提示）/'skip' → abstain；env 经 `buildCheckEnv(..., 'none')` 构造（显式不接证据，语义见 core/constraints/checkers/types.ts 工厂 doc）；`ctx.runEnv` 传入即整条守卫链共用一枚运行级观察面——项目配置文件整链至多读一次，不传则每道门禁自造一枚一次性观察面（判定不变，ADR-0023）
- 门禁类：`ReviewGate` / `SecurityGate` / `PerformanceGate` / `ContractGate` / `SpecAcceptanceGate` / `CommandGate`（各自执行细节私有，保留 `check()`/`scan()` 报告方法）；SpecAcceptanceGate 的 runner 输出解读与 e2e 判负都从 `core/validators/test-output.ts` 的 `judgeTestRun` 取（解析收口 ADR-0012、判定依据 ADR-0014，本层既不自带正则也不自写判定 `if`）
- 命令黑名单的模块级出口（`command.ts`）：规则表正本 `DEFAULT_COMMAND_BLACKLIST`（每台 `CommandGate` 实例构造时拷它作基线，运行时扩展点是 `addRule()`）、默认实例单例出口 `getCommandGate()`、快捷判定 `isCommandAllowed(command)` → boolean 与 `getCommandRiskLevel(command)` → `'high' | 'medium' | 'low'`（后三者都经包根对下游公开，ADR-0003 显式清单）。仓内不靠它们做判定：CLI `command` 用带配置的那台实例（#135/ADR-0024，`command-gate-dead-options.test.ts` 钉住 CLI 源码零引用 `getCommandGate(`/`getCommandRiskLevel`），hook 恒裸构造（见「约定」）；`DEFAULT_COMMAND_BLACKLIST` 的仓内消费者是 `harness command --list` 的展示
- `types.ts` — GateResult（报告结构，保留）/ GateContext / GateDecision 等公共类型 + 报告构造器 `pass` / `fail` / `fromError`（动态 passed 走 `gateResult`）：timestamp 与 duration 口径唯一落点，门禁实现禁止手写 GateResult 字面量（duration 是可选字段，漏写无编译期报错）。**`GateContext` 只带运行信息（在哪跑 / 跑什么），配置一律走构造器**——曾有 6 个与构造器平行的配置型字段（`projectId` 等），填了不生效，已删（架构评审候选1）
- 便捷工厂函数：createReviewGate / createSecurityGate / createPerformanceGate / createContractGate / createSpecAcceptanceGate / createCommandGate

## 依赖关系
- 依赖 `src/core/`（checker-gate 适配 checkers 注册表类型并经 `buildCheckEnv` 构造执行环境）
- 依赖 `src/types/` 公共类型

## 约定
- 新门禁必须：① 在 `definitions.ts` 补 GateDefinition（含 CLI 元数据）② 在 `registry.ts` IMPLEMENTATIONS 注册实现（缺一 → 加载期抛错）③ 实现统一 Gate 接口（evaluate 产三态决策，报告由 `types.ts` 的 `pass`/`fail`/`fromError`/`gateResult` 构造，不手写字面量）④ 配 CLI 命令（命令实现文件 + CLI 元数据的 module+export 引用，bin 由定义表驱动生成，不再手写块）+ 测试文件
- deny 单调是接口契约：决策浅冻结，下游不得改写上游决策
- **统一接口 `evaluate()` 的生产消费者 = 6 个门禁 CLI 命令**（架构评审候选1 步骤 2）：命令一律穿过 `evaluate()`，`GateDecision → CommandResult` 的映射与失败措辞收在 `src/cli/gate-command.ts` 一处，不再各写一遍（此前是 6 份 `<id> gate denied` + 4 份 `<id> gate error`）。报告面 `check()`/`scan()` 仍是各门禁私有实现，只展示不判断的子命令（`security audit` 等）直读它
- `runGates` 是 Gate **链**语义的参考实现（deny 单调 / ask fail-closed / 全决策浅冻结）：链级无生产调用方——6 个命令各跑一项（CLI 文件驱动逐命令执行），studio `runCompletionGuards` 是自己的三个 checker、不 import 本层，故消费方只有测试。「deny 后短路跳过剩余门禁」类优化在出现真实链消费者前不做——它与「按执行顺序的全部决策」报告契约直接冲突，短路等于改 GateResult 语义（harness#115 裁决，防后续评审重复提议）；`order` 字段与本执行器即为该复开点保留（config.yml 的声明式顺序/开关面按 ADR-0022 口径收缩，理由记在 ADR-0002 文末「后续变更」）
- ask 枚举预留：暂无实现，runGates fail-closed 按 deny 计
- **收到的根要传到自己每个 IO/执行点（harness#95）**：门禁只认 `context.projectPath`，内部相对子路径一律锚到它（`SpecAcceptanceGate` 的 tasksPath、`ContractGate` 的 contractPath、e2e/scan 的 `cwd`），禁止「根已传入却又取 cwd」、禁止 `xxxPath: './…'` 相对默认值——否则 `-p` 半失效且表现为假绿（acceptance 的「无 tasks.yml 即跳过」= passed:true）。本层唯一保留的 cwd 站点是 `checker-gate` 对 `ctx.projectPath` 的缺省兜底（豁免理由见守护表）。适用域自 #139 起覆盖到 monitoring 侧的落点默认值：约定正本是「相对片段（`DEFAULT_TRACE_FILE`）必须由消费点锚根」，闸 3 的键名后缀由 `Path` 扩到 `Path|File|Log` 并新增 `xxxFile: SOME_CONSTANT` 常量引用臂（本层曾漏检的形状正是它）。约定正本与四道机器可检的闸见 `src/cli/commands/CONTEXT.md`
- **CommandGate 的匹配语义只有一个落点（#135/ADR-0024）**：谓词 `match`（规则表遍历 + 类别忽略 + 模式测试）与折裁点 `judge`（级别 → 三桶 + `allowed` + `riskLevel`），`check()` / `isAllowed()` / `getRiskLevel()` 是这份裁决的三个投影——禁止在投影里再写匹配循环。`match` 原为私有，P1-7（ADR-0031，wayfinder 票08）起提为公共同步只读面：pretool-use-hook 需要命中明细（rule id/level）写审计 trace，`isAllowed` 的布尔投影丢掉了 hits；谓词语义不变，调用方不得改返回数组。等级取命中集合里的最高档而非首条命中，不变式「存在阻断级命中 ⟺ `check` 不通过 ⟺ `isAllowed` false ⟺ 等级 high」由 `__tests__/command-single-predicate.test.ts` 的源形状闸（`pattern.test(` / `ignoreCategories.includes(` / 遍历规则表的循环体各恰好一处）+ 三投影一致性闸钉住
- **hook 只用出厂规则（#135 裁决，不是疏漏）**：`src/pretool-use-hook.ts` 恒裸构造 `new CommandGate()`，不装项目配置——hook 是 fail-open 的纵深防御一道，阻断级之外的命中同样放行（`isAllowed` 只看阻断级）；配置装载只属于 CLI 侧（`harness command`，判定与 `--level` 共用它创建的那台实例）。两条入口是同一决策模块的两个 adapter，不得在 hook 路径另起一套判定
- **本入口的值面（24 项运行时导出）逐字冻结在 `src/__tests__/public-value-surface.test.ts`**（ADR-0022 追记第 5 条收口）：删掉或新增任一值导出——含上面 6 个 `create*Gate` 工厂（其中 5 个是本入口内联声明）——即红且指名 `./gates` 与符号，「这个函数不在公开面上、删它非 breaking」不再靠人 grep。本入口的值导出恰好全数是包根 `.` 的子集，删除会连带撞 `public-exports.test.ts`，但那个套件报的是 `.`、分不清入口归属；类型面另归 `public-type-surface.test.ts`。增删属公共面 breaking，须走发布级别裁决（ADR-0003/0022）

## 注意事项
- 门禁系统不包含业务逻辑，只提供检查能力
- `acceptance.ts` 的 13 处 return 是 `AcceptanceGateResult`（无 gate/duration 字段，`evaluate()` 归一化为 GateResult 报告——设计如此，见该方法注释），不是 GateResult 字面量，故不套 `pass`/`fail` 构造器；改成 GateResult 会动公共类型形状
- 统一的是决策协议（id/order/三态），执行细节（gh pr view/正则黑名单/OpenAPI diff/json-summary 覆盖率）私有——不要把执行细节塞进 Gate 接口
- `PerformanceGate` 只执法有真实现的维度（coverage 走 json-summary、bundleSize 走 dist 测量）；responseTime/memoryUsage/throughput 三维无真实现（原 Math.random 伪造 + 未接线的 runBenchmark）已随 benchmark 机制整体删除（ADR-0018，架构评审候选2）
- config.yml gates 段为新增面：引用未注册 id 直接抛错（无历史残留配置需兼容）
- CommandGate 为命令黑名单检查(SEC-006)
- `SecurityGate` 的扫描命令是**三级优先级**（`scan()` 内 `??` 链，自上而下取第一个已提供值）：① `context.securityScanCommand` ② 构造时传入的 `scanCommand` ③ `detectScanCommand()` 自动探测（现为常量 `npm audit --json`）。缺省「未提供」的唯一表示是 `undefined`——构造器把 `''` 归一成 `undefined`（`getConfig()`/`this.config` 因此是 `SecurityGateConfig` 而非 `Required<…>`，`scanCommand` 保持可选）；曾因兜成空串令 `??` 链恒停在第二级、第三级探测不可达，`harness security` 不带 `--scan-command` 必抛 `The argument 'file' cannot be empty`（#138）。按包管理器探测（读 lock 选 pnpm/yarn）与 `auditDetails` 的吞错各另开票，本层不改 `detectScanCommand` 常量返回
