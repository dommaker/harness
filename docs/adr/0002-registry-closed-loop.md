# ADR-0002: 注册型能力一律「定义即注册 + 构建期闭环」

- 日期：2026-08-16
- 状态：已接受（2026-09-15 部分失效：门禁侧「声明式生效集」面已收缩——`getEffectiveGates` 与 config.yml `gates.order` / `gates.<id>.enabled` 删除；注册表闭环与统一接口本身不动。判据与影响面见文末「后续变更」）
- 影响版本：1.0.0

## 背景

harness 有 4 类「注册型能力」——能力以「id → 实现」的方式登记后由调用点遍历/查表消费：

1. **checker**（约束检查器）：`ConstraintCheck{id, evaluate(env)}`，已随 ADR-0001 落地「定义即注册 + 构建期闭环」——`kind='check'` 的约束定义与 `src/core/constraints/checkers/index.ts` 注册表加载期双向校验，缺失即抛错、拒绝静默 pass。
2. **hook**（生命周期钩子）：平铺 `name → HookDefinition` Map，无闭环；studio 侧 `registerAllHooks` 7 个手工注册，靠 prompt 规矩 `hook_must_be_registered` 兜底——规矩本身即是「机制缺失、只能靠人记」的证据。
3. **门禁（Gate）**：6 个独立类仅共享 `GateResult` 报告接口，无统一注册表、无声明式顺序/开关；命令入口在 `bin/harness.js` 手工 `program.command(...)` 块，新增门禁要同时改 `gates/index.ts` 导出桶 + `cli/commands/index.ts` + `bin/harness.js` 三处。
4. **命令（CLI）**：`bin/harness.js` 手工 commander 块 + `commands/index.ts` 导出桶，两处手工同步。

共性故障类：**「定义了但没登记」**。checker 侧已被机制消灭，hook/门禁/命令仍靠人记（#29 设计空间 §1 结论）。

#30 裁决（HITL）：方案包 B「注册表统一化」全做、止步档 1（统一 Gate 三态 + hook/命令闭环 + 档 1 声明式元数据，排除档 2 依赖解析、档 3 dispose 链）；2c 升 ADR-0002；术语入词典。实现工单 H4（#43）/H5（#44）已随 1.0.0 合入 master（PR #50/#51）。

## 决策

### 统一约定

所有注册型能力一律遵循「定义即注册 + 构建期闭环」：

1. **定义表（纯数据）**：能力形状的单一来源，含 `id` + 元数据；禁止 import 任何实现/运行时依赖（保 `--help`/`--version` 懒加载）。
2. **注册表（实现）**：`id → 实现` 的 Map，加载期装配。
3. **双向闭环校验**：定义无实现 / 实现无定义 / 重复 id → 抛错，拒绝静默缺失。
4. **引用未注册 → 抛错**：查表/配置引用未知 id 同样抛错（无历史残留需静默兼容的新面）。
5. **校验时机**：闭环断言发生在构建/测试期（checker/门禁在模块加载期即断言，hook 由 consumer 在注册点调用断言、命令由 `registry.test.ts` 断言），不进运行时热路径、不破坏懒加载。

### 各能力落地形态

- **checker**（既有，ADR-0001）：`src/core/constraints/checkers/index.ts` 加载期双向校验，是其余三类的范式模板。
- **门禁 Gate**（H4/#43）：`src/gates/types.ts`（`Gate{id, order, evaluate(ctx)}` → `GateDecision`）、`definitions.ts`（`GATE_DEFINITIONS` 定义表 + CLI 元数据）、`registry.ts`（`gateRegistry` + `assertGateRegistryClosed` 加载期双向校验）、`runner.ts`（`runGates`）、`effective-gates.ts`（`getEffectiveGates`，对齐 `getEffectiveConstraints` 的 config 裁剪）。6 门禁 CLI 命令由定义表驱动生成，bin 不再手写 6 块。
- **hook**（H5/#44）：`src/hooks/registry.ts` 的 `assertHookRegistryClosed(configs, hooks)` 双向校验「声明（HookConfig）↔ 实现（HookDefinition）」；断言是纯函数、限构建/测试期；harness 无内置 hook 定义，由 consumer 在其注册点/测试中调用。per-hook 配置归一走 `errorStrategy`（`toErrorStrategy` 承载 `blocking → block/warn` 无损映射），不再维护平行 blocking 语义。
- **命令**（H5/#44）：`src/cli/commands/definitions.ts` 的 `COMMAND_DEFINITIONS` 是命令形状单一来源；`bin/harness.js` 遍历注册表驱动生成、删 `commands/index.ts` barrel；实现引用 `module+export`、per-command 懒加载（O2），实现引用可解析性由 `__tests__/registry.test.ts` 构建/测试期断言。

### Gate 统一守卫接口（G1）

- `Gate{id, order, evaluate(ctx)}` → `GateDecision{status, result}`；`status` 三态 `deny | abstain | ask`。
- 统一的是决策协议（id / 声明式 order / 三态），执行细节（gh pr view / 正则黑名单 / OpenAPI diff / benchmark）私有。
- `deny` 单调是接口契约：`runGates` 中 deny 一旦出现，下游 abstain 不得改回 allow，决策对象浅冻结。
- `ask` 枚举预留、暂无实现 → `runGates` fail-closed 按 deny 计。
- `GateResult`（`gate/passed/message/details/timestamp/duration`）保留为报告结构，不作决策层。
- `createCheckerGate(check)`（`src/gates/checker-gate.ts`）为 checker-as-guard 接线点：`false → deny`、`true/'skip' → abstain`。

### 术语（#30 裁决，入词典）

- **插件** = harness 扩展点统称（hook / checker / 门禁 / 命令），非运行时插件容器。
- **Gate（门禁）** = 统一守卫接口；「守卫 guard」仅 dsh 借鉴语境，不进入 harness 命名。
- **回滚** = 两者分工：版本化回退（单段——yml 数据文件 git 版本化，`retire` 落盘 `enabled:false` + `retired` 元数据、回滚即删段恢复）+ 提案回滚（多段 inverse，形态 A 内联 inverse 字段，挂 studio#82 D6）。
- **文件驱动 CLI** = yml 状态真值 + 一次性进程、无常驻生命周期；故不引 dispose 链。

## 后果

- 「定义了没登记」故障类在 hook/门禁/命令三类侧由机制消灭，`hook_must_be_registered` 类 prompt 规矩随之退役（studio 侧随动）。
- 新增能力 = 定义表一条 + 注册表一条 + 测试，不再改 `bin/harness.js` 手工块 / index.ts barrel。
- BREAKING：门禁接口统一（`GateResult` 报告 → `GateDecision` 三态决策）；6 门禁 CLI 命令名/别名/选项行为保持兼容。
- 懒加载保持：`--help`/`--version` 零命令实现加载（仅多一个纯数据模块），单命令只加载自身模块。

## 明确不做（防止静默残留）

- 档 2 依赖解析/拓扑排序：现状无能力间依赖拓扑需求，纯预留，不建 `deps[]` 解析。
- 档 3 dispose 链 / 可卸载生命周期：harness 无常驻进程、副作用是 yml 落盘（git 兜底），无运行时资源承载面；若未来需要，承载面在 studio 侧进程内回路。
- 引 cordis / dsh 运行时依赖：既定结论不引，全部自研落地。

## 后续变更（2026-09-15，架构评审 2026-09-14 候选 1）

**本 ADR 的门禁执行半收缩一项，其余照旧生效。**

失效内容：`effective-gates.ts`（`getEffectiveGates` + `GatesConfig`）与 config.yml 的 `gates.order` / `gates.<id>.enabled` 声明式面，连带四个门禁配置接口里的 `enabled` 字段及各自「禁用即放行」分支。`package.json` 的 `./gates` 子路径入口不动。

判据是三条事实叠在一起，不是审美：

1. **零调用方**——`runGates` / `getEffectiveGates` / `getGate` 在 harness 与 studio 两仓的生产路径均无消费者（CLI 当时逐命令直调 `check()`）。
2. **零配置数据**——harness 自身没有 `.harness/config.yml`；studio 与 studio-prod 两份配置文件各 43 字节（只有 `preset` 与 `harness.version`），`harness init` 生成的模板也不写 `gates:` 段。
3. **无文档承诺 + 无纠错能力**——README 无该段示例；加载器只做 `{...DEFAULT_CONFIG, ...raw}` 不校验顶层键，`ProjectConfig` 类型里也没有 `gates` 字段，`getEffectiveGates` 自己钻 `raw.gates`。也就是说把 `gates:` 拼错不会有任何提示——一条对外配置面在没有任何执法的情况下存在了一个多月。

`enabled` 单独说明：它与生效集是**从未接上的两半**。`getEffectiveGates` 的裁剪方式是「从数组里移除门禁」，从不往实例写 `enabled:false`；CLI 也不传该字段。于是四段 `if (!this.config.enabled) return pass(...)` 没有任何代码路径能触发，只有它们自己的单元测试在供养。

保留部分及理由：

- **注册表闭环**（`assertGateRegistryClosed` + `getGate` 引用未注册抛错）——这是本 ADR 真正值钱的东西，它消灭的故障类「定义了但没登记」与执行方式无关。消费者是 `gates/registry.ts` 加载期与 `cli/__tests__/registry.test.ts`。
- **统一接口 `Gate{id, order, evaluate(ctx)}` 与 `GateDecision`**——不但没删，反而第一次拿到生产消费者：六个门禁 CLI 命令的判定自本车起一律穿过 `evaluate()`，`GateDecision → CommandResult` 的映射与失败措辞收在 `src/cli/gate-command.ts` 一处（此前是「`<id>` gate denied」6 份、「`<id>` gate error」4 份）。`GateContext` 同批瘦身：删 `projectId` 及 5 个与构造器平行的零读取字段，此后「只带运行信息、配置走构造器」写进 `gates/CONTEXT.md`。
- **`runGates` 与 `order` 字段**——链语义（deny 单调 / ask fail-closed / 决策浅冻结）是判定层里唯一一处真逻辑，57 行、6 条测试。它的消费者仍然只有测试，但 #115 的裁决已把复开条件写明：「若未来出现真实门禁链消费方，可重开」。故留 `order` 与本执行器作该复开点，删掉的只是「用户可声明式改写顺序/开关」这一层。

定级：`GateContext`、`Gate`、`getEffectiveGates`、`GatesConfig` 与四个 `*GateConfig` 属包根公开导出，删必填字段与删导出符号对下游是编译级变更。按 ADR-0022 口径走 minor（2026-09-09 人类裁决：breaking 内容按 minor 号发布）。studio 侧受影响面一处：`apps/api/tests/review-gate.test.ts` 按类型构造 `GateContext` 时填了 `projectId`，随动单独开票。
