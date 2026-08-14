# DSH 插件化/可回滚在 harness 的落点选项（设计空间）

> 创建日期：2026-08-15
> 状态：设计空间菜单（供 HITL grilling 裁决，**不自行下结论**）
> 前置：`docs/2026-08-15-dsh-plugin-architecture-research.md`（6 点结论，既定输入，不重研不推翻）；dsh 技术参考 `docs/deepseek-harness/reference.md`（仓库外）
> 关联票：wayfinder #29（本票）、#26（地图，主会话统一更新，本票不碰）

---

## 0. 读法与口径

- 本文把「一切皆插件、插件可回滚」细化为 **4 个单选项 + 3 个方案包**，每个单选项给 6 段：dsh 概念映射 / harness 现状接缝 / 改什么 / 成本收益 / 风险 / 工作量估计。
- 只给选项与对比，不裁决。方案包（§6）是「可挑选或混搭」的菜单，最后附方案包对比表。
- 行号证据均来自本 session 实际 read 输出；dsh 侧证据复用 reference.md 已有行号，不重研。
- 核心约束（贯穿全文，来自研究结论 6）：**harness 是文件驱动 CLI 框架、无常驻容器**；借鉴设计 ≠ 引依赖，全部可自研；dsh（developer preview）与 Cordis（API 未稳定）不满足 harness 定位，不引运行时依赖。

---

## 1. 现状接缝速查（本文所有选项的共同落点）

| 能力 | 现状形态 | 接缝证据 |
|---|---|---|
| hook | 平铺 name→def `Map`，无依赖、无闭环；phase+priority 排序 | `src/hooks/registry.ts:9-27`、`pipeline.ts:30-58`；studio 侧 `registerAllHooks` 7 个手工注册（调研 §2） |
| checker | **已闭环**：加载期双向校验「check 未注册→抛错」「注册无定义→抛错」 | `src/core/constraints/checkers/index.ts:26-64`；`ConstraintCheck{id, evaluate(env)}` `checkers/types.ts:40-45` |
| 门禁（gates） | 6 个独立类，共享 `GateResult` 但无注册表、无声明式顺序/开关；命令入口硬编码 | `src/gates/types.ts:8-15`；`src/gates/`（review/security/performance/contract/acceptance/command） |
| 命令（CLI） | `bin/harness.js` 手工 commander 块 + `commands/index.ts` 导出桶 | `bin/harness.js:16-18`（懒加载 `cmd()`）、每个命令一个 `program.command(...)` 块 |
| 生效约束集 | 单一来源 `getEffectiveConstraints`：内置→preset→禁用→custom 追加→scenes | `src/core/effective-constraints.ts:25` |
| 验证 | 规则引擎（`VerificationRule{id,type,command\|verify}`）+ Gather-Act-Verify loop | `src/verification/rules-based.ts:11-22`、`loop.ts:25-113` |
| 约束变更落盘/回滚 | yml 数据文件（git 版本化）；retire 落盘 = `enabled:false` + `retired` 元数据，回滚 = 删段 | `src/cli/commands/constraints-retire.ts:25-26,145-206,374-378` |
| KnowledgeStore | 退役写一条记录（`consumptionMode:'signal'`，entryId `constraint-retired-<id>`） | `constraints-retire.ts:211-266` |
| 决策基线 | check/prompt 二元模型 + 注册表闭环（ADR-0001） | `docs/adr/0001-constraint-system-rearchitecture.md:34-39,57` |

结论：**checker 已是「定义即注册 + 构建期闭环」的成熟范式；hook/gate/命令/守卫仍是「手工列表/手工入口」，同一故障类（定义了但没登记）在 checker 侧被机制消灭、在其余侧仍靠人记。**

---

## 2. 单选项 1：统一守卫/门禁接口

### 2.1 dsh 概念映射

- dsh 把审批/沙箱/超时/日志全部挂到一条工具管线上：`tools/pre-execute`（可重排允许/拒绝/询问）→ **单调守卫** `ctx.tools.guard(guard)`（返回理由=拒绝，返回 `undefined`=放行，后续 waterfall 不能把拒绝改回允许）→ `tools/execute`（环绕包装）→ `tools/post-execute`（接受/阻止/替换/附加上下文）→ `tools/result`（仅观测）。见 reference.md §7（`tool-execution-pipeline.md:60`、`tools/index.ts` guard `:1110-1116`）。
- **关键性质**：守卫/审批/沙箱/超时是**同一类「管线监听器/守卫」插件**，loop 只发事件、不知道有哪些守卫；守卫顺序可声明、可独立开关；单调语义保证「已拒绝不可被下游改回允许」（fail-closed 方向不可逆）。

### 2.2 harness 现状接缝

- gates 6 个门禁是 6 个独立类，仅共享 `GateResult` 报告接口（`{gate, passed, message, details, timestamp, duration}`，`src/gates/types.ts:8-15`），**无统一注册表、无声明式顺序/开关**。
- 每个门禁在 `bin/harness.js` 手工 `program.command(...)` 硬编码入口（如 `review`→`cmd('review')`）；新增门禁要同时改 `gates/index.ts` 导出桶 + `cli/commands/index.ts` + `bin/harness.js` 三处。
- `GateResult` 语义是「事后报告」而非「决策管道」：无单调语义、无 waterfall、无「拒绝不可改回」约束。
- checker 已有 `ConstraintCheck{id, evaluate(env)}` + 注册表闭环，是守卫统一化的现成模板（`checkers/types.ts:40-45`）。

### 2.3 改什么（子方案，从轻到重）

- **1a. 统一 Gate 接口 + 注册表**：把 6 个门禁的 `check()` 收敛为统一 `Gate{id, order, evaluate(ctx) → GateDecision}`；建 `gateRegistry`；`runGates(ids, ctx)` 按声明式 order 遍历。CLI 命令从「每门禁一个手工块」变「注册表驱动生成」。
- **1b. 单调守卫语义**：把 `GateDecision` 三态明确为 `deny | abstain | ask`，`deny` 不可被后续守卫改回 allow（对照 dsh guard）。
- **1c. 声明式顺序/开关**：`order`/`enabled` 字段来自 config.yml（如 `gates.review.enabled:false`、`gates.order:[...]`），与 `getEffectiveConstraints` 的「config 裁剪」模式对齐。

### 2.4 成本/收益

- **收益**：新增门禁/守卫 = 只加一个定义（定义即注册），不再手改命令入口三处；顺序/开关可声明；checker-as-guard 接入点统一（#82 D4 的 checker 接线从「在 `runCompletionGuards` 函数体加 if」变「注册一个守卫」）。
- **成本**：中低。重构 6 门禁 + `bin/harness.js` 注册 + 适配测试；CLI 命令名/行为保持兼容，不破坏现有调用方。

### 2.5 风险

- **接口过抽象**：6 门禁 I/O 异构大（review 走 `gh pr view`、command 走正则黑名单、contract 走 OpenAPI diff、performance 走 benchmark），统一接口若把执行细节也塞进去会变成「一个接口装不下」。需明确**统一的是决策协议（deny/abstain/ask + order + enabled），执行细节仍由各实现私有**。
- **与 `simplest_solution_first` 冲突**：若门禁长期只有 6 个且不新增，统一化是为「一次性抽象」的 speculative 重构。缓解判据：`checker-as-guard`（#82 D4）是否确定要接入——若确定，统一化就顺带消灭一个硬编码点，价值成立；否则可缓。

### 2.6 工作量估计

中（约 1–2 天含测试；约 500–800 行改动，其中 `bin/harness.js` 注册重构占比最大）。

---

## 3. 单选项 2：注册表闭环推广

### 3.1 dsh 概念映射

- dsh/Cordis 用 `inject` **声明**依赖，解析/等待/响应式重载是框架职责，加载顺序由依赖推导、不靠手工编排（reference.md §4.4，`fiber.ts:611-639`）。
- **关键性质**：新增插件不需要在别处「注册它依赖谁」——它自己声明，框架接线；从机制上消灭「定义了但忘了在编排处登记」的故障类。

### 3.2 harness 现状接缝

- checker 已闭环（`checkers/index.ts:26-64` 双向校验），是唯一「机制消灭故障类」的模块。
- hook 是平铺手工列表：`HookRegistry` 无闭环校验；studio 侧 `registerAllHooks` 7 个手工注册；`hook_must_be_registered` 是 prompt 规矩兜底——规矩的存在本身就是「机制缺失、只能靠人记」的证据（调研 §2）。
- guard/门禁/命令同理：门禁无注册表（§2），命令在 `bin/harness.js` 手工块。

### 3.3 改什么

- **2a. hook 自注册/完整性断言**：把「全量 import + 构建/测试期完整性断言」引入 hook——每个 `hooks/*.hooks.ts` 导出的 hook 必须出现在注册表，漏注册 → 构建/测试失败。消灭 `hook_must_be_registered` 规矩。
- **2b. 推广到门禁/命令**：门禁注册表（与选项 1 重合）+ 命令注册表（命令定义即注册，`bin/harness.js` 从「手工 commander 块」变「遍历注册表生成」）。
- **2c. 固化跨模块约定（可选 ADR）**：把「注册型能力一律走『定义即注册 + 构建期闭环』」上升为跨模块约定（checker/hook/守卫/门禁/命令统一），供未来新增能力照抄。

### 3.4 成本/收益

- **收益**：把「定义了没登记」从「靠人记」变「构建期报错」；删掉 `hook_must_be_registered` 这条 prompt 规矩；复用 checker 既有成熟模式，推广成本低。
- **成本**：低。核心是复制 `checkers/index.ts` 的加载期双向校验逻辑到 hook/命令/门禁。

### 3.5 风险

- **完整性断言的实现边界**：「全量 import」与「文件系统扫描 + 约定目录」各有边界情况（动态 import、条件注册、跨包注入 studio 侧的 hook）。需明确断言运行在**构建/测试期**（不进入运行时热路径）。
- **与懒加载的冲突**：`bin/harness.js` 的懒加载（工单 17，`--help/--version` 不加载全部实现）不能因「命令注册表驱动生成」而被破坏——闭环校验必须发生在构建/测试期，而不是运行时全量 require。

### 3.6 工作量估计

低-中（约 1 天；`hook` 闭环 + 门禁/命令注册表是主要改动面）。

---

## 4. 单选项 3：可逆 effect 建模（变更 + inverse 回滚）

### 4.1 dsh 概念映射

- Cordis 回滚 = **副作用登记**：每个副作用登记时显式携带逆操作（disposer），运行时按 fiber 记账、**逆序执行**、await 异步清理（reference.md §4.6，`fiber.ts:403-414,431,675-686`）。
- **关键性质**：回滚能力不是运行时推断出来的，是每个副作用登记时就显式携带逆操作；这是「可逆 effect 纪律」，不是通用事务/快照。

### 4.2 harness 现状接缝

- 约束实例变更落点 = `custom-constraints.yml` / `config.yml` 数据文件（git 版本化，整文件 revert 白送）。
- `retire` 落盘 = `enabled:false` + `retired` 元数据；回滚 = 删段恢复（`constraints-retire.ts:25-26,374-378`）。
- **无**进程内副作用登记/dispose 链；harness 无常驻容器，副作用是「yml 落盘」而非「运行时资源」。
- KnowledgeStore 已承接退役记录（`saveRetireKnowledge`，entryId `constraint-retired-<id>`，`consumptionMode:'signal'`，`constraints-retire.ts:211-266`）。

### 4.3 改什么（建模选项）

- **3a. inverse diff 存储形态（三选一）**：
  - **形态 A：提案记录内联 `inverse` 字段**——apply diff 与 inverse diff 成对存储，回滚 = 应用 inverse。最贴合 Cordis「副作用登记时携带逆操作」。
  - **形态 B：落盘前快照**——变更前 yml 段副本存入提案记录，回滚 = 恢复快照（三路合并/覆盖）。
  - **形态 C：事件溯源**——append-only 变更事件 + replay，回滚 = 追加 inverse 事件。
- **3b. 按提案粒度回滚接口**：`applyProposal(diff) → {proposalId, inverse}` + `rollbackProposal(proposalId)`；多段变更（新增+override+retire 并存）**原子**回退——git 只能整文件 revert，无法按提案粒度回退。
- **3c. 与 KnowledgeStore 衔接**：inverse/回滚记录作为 KnowledgeStore 条目（复用 `type:'decision'` 或新增类型），回滚后再写一条 rollback 记录，形成「变更→审计→可回滚」闭环。

### 4.4 成本/收益

- **收益**：多段变更原子回滚 + 提案级可审计回滚；#82 D6「进化提案落地通道」的天然挂点（一个提案改多段时，回滚要原子地一起回退）。
- **成本**：低-中（提案记录多存一个 inverse/快照字段；回滚接口需新增 CLI 命令或复用 retire 语义）。

### 4.5 风险

- **inverse 是文本级而非语义级**：应用 diff 后若文件被手工改过，inverse 可能不再适用——需要 pre-image 校验（三路合并）或「回滚前校验当前内容仍等于 apply 后快照」。
- **超前建模**：当前变更通道主要是 retire（单段、删段即恢复），提案落地通道（#82 D6）尚未实现；若先建 inverse 框架而无消费方，是 speculative。缓解判据：挂点应落在 #82 D6 实现时（邻接立项），不单独先建。

### 4.6 工作量估计

低-中（约 0.5–1.5 天，取决于 3a 形态：A 最轻、C 最重）。

---

## 5. 单选项 4：插件声明与生命周期（轻量自研 → Cordis-lite 频谱）

### 5.1 dsh 概念映射

- Cordis 插件 = 函数/类/对象 + **声明元数据**（`name`/`inject`/`provide`/`intercept`，reference.md §12.1），依赖声明 → 框架解析加载顺序。
- FiberState 生命周期：`PENDING→LOADING→ACTIVE→FAILED/UNLOADING→DISPOSED`，卸载时 disposer 逆序执行（reference.md §4.5-4.6）。

### 5.2 harness 现状接缝

- harness 是**文件驱动 CLI 框架、无常驻容器**：命令 = 一次性执行（`bin/harness.js` parse → action），无进程内插件树。
- hook/gate/checker 都是「静态注册表 + 调用点遍历」，无生命周期状态机。
- `bootstrapHarness` 一次性初始化（HookRegistry + HookPipeline + checker 单例），**无 unload/dispose**（`src/hooks/bootstrap.ts:66-97`）。

### 5.3 改什么（频谱，从轻到重）

- **档 0（现状基线）**：无运行时容器，静态注册表 + 手工调用点。
- **档 1（轻量自研：声明式元数据 + 静态注册表，无运行时容器）**：给 hook/gate/checker 统一「声明式元数据」（`id/order/enabled/deps[]` 纯数据），静态注册表，构建期解析（加载顺序推导），无进程内生命周期/热插拔。≈ 选项 1 + 选项 2 的合并产物。
- **档 2（静态容器：声明 + 依赖解析 + 加载顺序推导，无卸载）**：在档 1 上增加「依赖声明 → 拓扑排序加载」；一次启动静态装配，无 reload/dispose。
- **档 3（Cordis-lite：插件声明 + 依赖解析 + 加载顺序推导 + 卸载 dispose 链）**：引入轻量 fiber（effect/disposer 记账 + 逆序卸载），支持 reload/卸载。

### 5.4 成本/收益（按档）

| 档 | 适用场景 | 收益 | 代价 |
|---|---|---|---|
| 1 | 现状 hook/gate/checker 数量级（个位到几十个） | 定义即注册 + 顺序声明，消灭手工列表/入口 | 低（0.5–1 天） |
| 2 | 能力间出现真实依赖拓扑（A 依赖 B 产物） | 顺序自动推导，消灭手工编排 | 中（1–2 天）；**现状无此需求** |
| 3 | 常驻容器 + 需热插拔/卸载 | 完整插件生命周期 + 可逆卸载 | 高（3–5 天）+ 需先解决常驻容器问题 |

### 5.5 风险与边界（关键）

- **档 3 的 dispose 链在 harness 内没有承载面**：harness 无常驻进程，副作用是 yml 落盘（有 git 兜底），不是运行时资源；「卸载 dispose 链」无处安放（研究结论 1/3 已判不引入进程内 dispose 链）。
- **边界**：若未来需要「可卸载的生命周期」，承载面在 **studio 侧**（#138 步内前置拦截 / #53 checker 接 agent-loop 落地后才出现进程内执行面），不在 harness。harness 侧的合理终点是**档 1（最多档 2）**。
- 引 cordis/dsh 依赖被明确排除（研究结论 6）。

### 5.6 工作量估计

档 1 ≈ 0.5–1 天；档 2 ≈ 1–2 天；档 3 ≈ 3–5 天 + 且需先解决常驻容器问题（不适合 harness，仅记录供 studio 侧参考）。

---

## 6. 组合方案包（供 grilling 挑选/混搭）

### 6.1 方案包 A — 最小选择性借鉴

- **定位**：只摘「可逆 effect 建模」单点，挂到 #82 D6 提案落地通道，其余不动。
- **包含项**：选项 3（形态 A 内联 inverse，最轻）+ 选项 3c（KnowledgeStore 衔接）。
- **相对收益/代价**：改动最小、单点收益（多段变更原子回滚）；不解决 hook/门禁/命令的手工列表问题。

### 6.2 方案包 B — 注册表统一化

- **定位**：把 checker 的「定义即注册 + 构建期闭环」推广为跨模块约定，消灭所有手工列表/手工入口。
- **包含项**：选项 1（守卫/门禁统一）+ 选项 2（hook/门禁/命令注册表闭环）+ 可选 2c（固化 ADR）。
- **相对收益/代价**：收益面最广（hook/gate/命令三类故障类一次性消灭，checker-as-guard 接入点统一）；代价中低，且为 #82 D4 提供现成接线点。

### 6.3 方案包 C — 插件化运行时（Cordis-lite 方向）

- **定位**：走向声明式插件 + 依赖解析 + 生命周期，但**止步于静态装配层（档 1/2）**，不引入进程内 dispose 链。
- **包含项**：选项 1 + 选项 2 + 选项 4（档 1，最多档 2）。
- **相对收益/代价**：为未来「能力依赖拓扑」留好扩展面；代价最高，且档 3（dispose 链）明确不适合 harness——若强推档 3 则与「文件驱动 CLI、无常驻容器」定位冲突。

### 6.4 方案包对比表

| 维度 | A 最小选择性借鉴 | B 注册表统一化 | C 插件化运行时（至档 1/2） |
|---|---|---|---|
| 一句话定位 | 单点 inverse 回滚，挂 #82 D6 | 定义即注册 + 构建期闭环，消灭手工列表/入口 | 声明式插件 + 依赖解析 + 静态装配 |
| 包含单选项 | 3（形态 A + 3c） | 1 + 2（+ 可选 2c ADR） | 1 + 2 + 4（档 1/2） |
| dsh 借鉴 | Cordis 可逆 effect 纪律 | `inject` 声明 + checker 闭环模式 | 插件声明 + 加载顺序推导 |
| 现状接缝命中 | 约束变更落盘/回滚（git 整文件 revert） | hook 手工列表、门禁/命令手工入口 | 全部注册型能力 |
| 收益 | 多段变更原子回滚 + 提案级审计 | 三类「定义没登记」故障类消灭 | 同上 + 依赖拓扑扩展面 |
| 代价 | 低（0.5–1.5 天） | 中低（1–3 天） | 中（2–4 天） |
| 主要风险 | inverse 文本级 vs 语义级、超前建模 | 接口过抽象、破坏懒加载 | 档 3 dispose 链无承载面（被明确排除） |
| 是否引依赖 | 否 | 否 | 否（自研） |
| 与 #82 关系 | 直接挂 D6 提案落地通道 | 为 D4 checker-as-guard 接线铺路 | D4 + 未来依赖拓扑预留 |

---

## 7. 结论（供 grilling 裁决的开放问题）

本文不下结论，仅把裁决点前置如下：

1. **守卫统一化的前置条件**：`checker-as-guard`（#82 D4）是否确定接入？确定 → 选项 1 价值成立；不确定 → 选项 1 是 speculative，可缓。
2. **闭环推广是否上升为 ADR**：若选 B，是否把「注册型能力一律『定义即注册 + 构建期闭环』」固化为跨模块约定（可选 2c）。
3. **inverse 建模的挂点**：选项 3 是否必须等 #82 D6 提案落地通道实现后再落地（避免超前建模），还是可先建「提案记录 inverse 字段」的 schema 预留。
4. **插件化边界**：明确「harness 侧合理终点 = 档 1/2，档 3 dispose 链归 studio 侧进程内回路」这一边界是否被认可。

> 说明：本文件为纯研究产出（docs 变更），未改动任何 `src/` 代码；git 隔离在 worktree `research/plugin-core-design-space` 分支。
