# ADR-0007: 门禁命令定义形状对齐 CommandDefinition，bin 单引擎单循环

- 日期：2026-08-19
- 状态：已接受
- 影响版本：1.2.0

## 背景

架构评审（2026-08-19，候选8）确认 bin/harness.js 存在第二条命令接线：非门禁命令走通用引擎 `buildCommand`/`runDefinition`（消费 `COMMAND_DEFINITIONS`），6 个门禁命令走独立循环（消费 `GATE_DEFINITIONS.cli`）。后者虽已数据驱动（H5），但 `GateCliDefinition` 与 `CommandDefinition` 是两份近乎同构的形状——选项接线（alias/description/options 循环）抄了一份，且门禁形状缺 optionRoutes/afterRun/children 三个特性；通用引擎修 bug 或加特性时必须记得同步第二循环，漏一处即行为分叉。

两形状的实质差异只有三处：门禁 `subcommands` 值是裸 `CommandImplRef`（通用形状为 `{impl, args?}`）、`mapActionArgs` 签名是 `(arg, options)`（通用形状为 `(positionals[], options)`）、以及两个行为语义位（见下）。

## 决策

形状对齐，不加转换层：

- 删 `GateCliDefinition`/`GateCliOption` 接口（公开导出的类型，breaking 攒入 1.2.0）；`GateDefinition.cli` 类型直接为 `CommandDefinition`，6 条门禁定义随动（subcommands 值包 `{impl}`、mapActionArgs 改 positionals 签名）。
- `CommandDefinition` 新增可选字段 `bareRunsAction`：有 subcommands 但无位置参数时运行默认 action 而非显示帮助。带 subcommands 的 4 个门禁（acceptance/contract/review/security）标 `subcommandStrict:false + bareRunsAction:true`，精确复刻历史门禁循环的「未知子命令落回默认 action + 裸跑执行 action」语义（如裸 `harness acceptance` 执行门禁而非显示帮助）。
- bin/harness.js 删第二循环，单循环消费 `[...COMMAND_DEFINITIONS, ...GATE_DEFINITIONS.filter(g => g.cli).map(g => g.cli)]`；`GATE_DEFINITIONS.filter(g => g.cli)` 的计数语义（cliCommandCount）不动。
- **不**选「gates/definitions.ts 导出薄转换层」方案：转换层本身是新的浅模块，两份形状照旧都得维护，只是多了第三处胶水。

## 理由

- 门禁 CLI 形状通过 deletion test：删除后选项接线/子命令路由/实参构造的复杂度集中到通用引擎一处，而非转移。
- 行为不变性有兜底：注册表闭环测试（24 命令面断言、裸 `harness acceptance` 冒烟、`knowledge bogus` strict 报错）+ 改动前后 root 与 6 门禁命令 `--help` 输出逐字 diff 一致（已验证）。
- studio 侧零消费 `GateCliDefinition`/`GateCliOption`/`GATE_DEFINITIONS`（2026-08-19 全仓 grep），类型级 breaking 无实际断裂面。

## 明确不做

- `GateDefinition` 本身（id/description/order/cli）不动，registry 双向闭环校验不动。
- 不单独发版：与其他 breaking 变更攒入同一 major；版本号与 CHANGELOG 由发布流程（harness-ship）管理。
