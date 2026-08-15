# DeepSeek Harness（dsh）插件架构调研与 @dommaker/harness 借鉴点

> 创建日期：2026-08-15
> 状态：调研完成（待 issue 定夺产出形态）
> 前置文档：dommaker/studio issue #140（调研任务）、issue #82（grill 会话，E1 裁决引出本调研）

---

## 结论摘要（可借鉴点清单）

| # | 调研问题 | 一句话核心结论 | 采纳建议 |
|---|---|---|---|
| 1 | 插件回滚语义 | Cordis 回滚 =「每个副作用登记一个逆操作（disposer），卸载时逆序执行」，是**副作用登记**而非事务/快照；约束实例变更（yml 在 git 内）已被 git 历史 + retire 可恢复覆盖 | **有条件**：借鉴「变更 = 可逆 effect（apply 返回 unapply）」建模，为多段约束变更补原子回滚；不引入进程内 dispose 链 |
| 2 | 依赖声明式管理 | Cordis 用 `inject` 声明依赖 + 运行时解析/等待/响应式重载，加载顺序由依赖推导，消灭手工编排；harness 的 `registerAllHooks` 手工列表靠 `hook_must_be_registered` 规矩防漏 | **有条件（轻量）**：把 checker「注册表闭环、引用未注册即构建报错」模式推广到 hook，用构建/测试期完整性断言替代纯手工列表；完整 DI 容器不值得 |
| 3 | checker/守卫作为插件 | dsh 审批/沙箱/超时/日志都是挂到「pre-execute → guard → execute → post-execute → result」工具管线上的插件；completion-gates 是同一模式但硬编码 3 条守卫 | **有条件（低摩擦）**：把守卫抽成统一接口 + 注册表 + 声明式顺序，checker 以注册接入；事件总线/热插拔不值得 |
| 4 | Code Mode | `run_code` 把 N 次工具调用压缩成 1 段程序，中间结果不回灌上下文；dsh 自研 agent loop 的可选 seam，studio 依赖第三方 CLI 无法照搬 | **有条件（低优先级）**：借鉴「批处理 + 中间结果不回流」思路，但 token 经济更直接杠杆是 compaction/预算；不照搬 run_code |
| 5 | Agent Preset | dsh preset = 可执行插件组合（真实工具注册 + prompt 段 + service，scope 分层），studio role = 纯文本 persona + 工具名列表注入 | **有条件（低优先级）**：role 现状覆盖「差异化加载」，但能力级 scope 隔离无法穿透第三方 CLI，短期不值得 |
| 6 | 许可证/依赖风险 | MIT 无许可风险；但 dsh 是 developer preview（明示破坏性变更）、Cordis API 未稳定 | **不引入依赖**：借鉴设计逻辑全部可在 harness 现有 TS 栈自研，不引 cordis/dsh 包 |

---

## 一手来源与核对口径

> **独立参考文档（本报告的长期查阅入口）**：`/root/projects/docs/deepseek-harness/reference.md`——dsh 单独的技术调研文档（包清单索引 + 机制行级引用 + 查阅速查表），配合本地完整 clone `/root/projects/deepseek-harness`（HEAD `47f9438`）。后续查阅 dsh 细节优先读它，本报告只承载与 @dommaker/harness 的对照结论。

- **DeepSeek Harness 官方仓库**（master）：https://github.com/deepseek-ai/deepseek-harness ，本次核对锁定 commit `47f943859bef60e4160492346772ded9b24f765a`（2026-08-13，"release: dsh@0.1.0-rc.5 & publish the dsh family publicly"）。
- **本机实际运行实现**：npx 安装的 `@deepseek-ai/dsh@0.1.0-rc.6`，源码在 `/root/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/`（含 `@deepseek-ai/cordis@4.0.1` 的 `src/*.ts` 与各包 `README.zh.md` 架构文档）。**注意：本机 rc.6 略新于 master 锁定的 rc.5**，冲突处以 master 为准，本报告以 master 文档为准、以本机源码为行级证据。
- **Cordis**：https://github.com/cordiverse/cordis （任务给定的 `cordisjs/cordis` 经 GitHub 重定向到 `cordiverse/cordis`，同一仓库），默认分支 `main`，核对锁定 commit `8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4`（2026-08-13），stars 3307。
- **Cordis 设计论文**：*A Programming Paradigm for Spatiotemporal Composability*，官方出处 https://github.com/cordiverse/paper （README 摘要 + `paper.pdf`，preprint draft 2026-08-13，锁定 commit `948a07b369c62adb3b12e102458be5c18dfb69b9`）。
- **网络限制说明**：本环境 `github.com:443`（git clone / raw.githubusercontent / codeload）不可达，但 `api.github.com`（经 `gh api`）可达。master 文件经 GitHub Contents API 逐文件拉取并 base64 解码，内容可靠；**未能完整 clone 仓库树**，`.agents/notes/**` 等 Agent Note 文件未逐篇读取（本报告仅把其路径当作「被 README 引用」的事实标注，不引用其内容）。

---

## 1. 插件回滚语义（Cordis dispose/回滚 vs #82 D6 约束实例变更回滚）

### dsh/Cordis 机制

Cordis 的回滚不是事务、不是快照，而是**副作用登记（revertible effect）**：论文把「时间组合性」定义为 *the ability to completely revert a component's side effects upon removal*，实现机制是 *revertible effects, in which every context transformation carries an inverse that the runtime tracks*（https://github.com/cordiverse/paper ，README 摘要）。

源码层面的实现证据在 `@deepseek-ai/cordis/src/fiber.ts`（本机 `node_modules/@deepseek-ai/cordis@4.0.1`）：

- 每个 fiber（插件运行时实例）持有一个 disposer 列表：`public readonly _disposables = new DisposableList<Disposable>()`（`fiber.ts:203`）。
- `Disposable` 就是「一个释放资源的函数」：`export type Disposable<T = any> = () => T`（`fiber.ts:74`），JSDoc 明确「Disposers run in reverse registration order when the owning fiber unloads; they may be async, in which case unloading awaits them.」（`fiber.ts:68-74`）。
- 插件的每个副作用通过 `ctx.effect()` 登记，effect 产出 disposer 并收集；同一 effect 内多个 disposer 逆序执行：`for (const disposable of disposables.splice(0).reverse())`（`fiber.ts:431`）。
- 卸载时清空并逐个 await disposer：`_unload()` 里 `await Promise.all(this._disposables.clear().map(async (dispose) => { ... await runDisposable(dispose) }))`（`fiber.ts:675-686`）。
- 服务注册也是可逆副作用：`Service` 基类构造时 `self.ctx.reflect.provide(name, self, this[symbols.check])`，JSDoc 声明「the service is unregistered automatically when the owning fiber unloads」（`@deepseek-ai/cordis/src/service.ts:9,32-36,57`）。

架构文档的一手表述与之印证：

> 各项注册都是副作用，会在其插件卸载时撤销。—— docs/architecture.zh.md（master）

> 注册是可逆的副作用。提示词片段、工具 schema、适配器、提供方和监听器通过 `ctx.effect()` 或 `ctx.on()` 安装，reload 和 teardown 时会按预期撤销。……每个注册都应有对应的 disposer。—— docs/cordis-primer.zh.md（master）

**关键性质**：回滚能力不是运行时推断出来的，而是**每个副作用在登记时就显式携带逆操作**，运行时只负责按 fiber 记账、逆序执行、await 异步清理。这是「可逆 effect」纪律，不是通用事务。

### harness/studio 现状

- harness 的约束实例变更（新增/override/retire）落点是 `custom-constraints.yml` 数据文件，回滚完全靠**版本化数据文件**：
  - #82 D6：「回滚不新造机制——retire 本身可恢复（删段即恢复），新增/override 走 git 历史（yml 在仓内，版本化白送）」。
  - harness README（`README.md:78`）：「退役不是删除——删除 config.yml 中对应段即可回滚」。
  - `retire` 落盘形态 = config.yml `enabled: false` + `retired` 元数据（ADR-0001 决策 5，`docs/adr/0001-constraint-system-rearchitecture.md:29`）。
- harness/studio **没有**任何进程内的副作用登记/dispose 链：知识库里唯一的「回滚」是领域专用的 BFS 级联重置（`~/.studio/knowledge/.archive/pattern-cascade-rollback.md`，源自 `integration-rollback.ts:rollbackToIntegrationStep()`，回滚的是 goal step 状态，不是副作用）。

### 可借鉴设计点 + 采纳建议

- **可借鉴**：把「一次进化提案落地的约束变更」显式建模为可逆 effect——每个 proposal 落地为「新增/override/retire 的具体 diff」，并**显式记录其 inverse（回滚 diff）**，而不是只依赖 git 事后 diff。#82 D6 的半自动补丁（提案 accepted → 生成 custom-constraints.yml 变更草案）正好是引入该建模的天然切入点：一个提案改多段（新增 + override + retire 并存）时，回滚要**原子地**一起回退，git 历史只能整文件 revert、无法按提案粒度回退。
- **不借鉴**：完整的 Cordis 式 dispose 链（进程内事件监听/服务注册/定时器清理）。harness 是**文件驱动的 CLI 框架**，不是常驻插件容器；它的「副作用」是 yml 落盘，不是运行时资源。给 yml 变更套 dispose 链属于杀鸡用牛刀。
- **代价与收益**：低代价（提案记录里多存一个 inverse diff 字段）；收益 = 多段变更的原子回滚 + 提案级可审计回滚。**建议：有条件采纳**，落点挂在 #82 D6「进化提案落地通道」邻接，而非独立立项。

---

## 2. 依赖声明式管理（inject/DI vs registerAllHooks 手工列表）

### dsh/Cordis 机制

Cordis 用**声明式依赖注入**，加载顺序由依赖推导，不靠手工编排：

> 通过 `inject` 声明服务依赖。插件声明所需的服务后，会等待这些服务就绪才启动；加载顺序通过服务依赖表达，而非手动编排启动序列。—— docs/cordis-primer.zh.md（master）

- 声明方式：插件函数挂 `inject` 数组（`@deepseek-ai/cordis/README.md` Quick Start：`Object.assign((ctx) => {...}, { inject: ['counter'] })`）。
- 解析方式：fiber 构造时把 `inject` 存为依赖映射（`fiber.ts:225`），`_checkImpl(name)` 逐个检查服务是否可用（`fiber.ts:597-609`），`_refresh()` 用「已解析 impl 的 fiber uid 拼接」算出 epoch（`fiber.ts:611-623`），`_setEpoch` 据此触发 load/reload/unload（`fiber.ts:625-639`）。即：**依赖未就绪 → fiber 停在 PENDING；依赖就绪或变更 → 自动加载/响应式重载**。
- 服务注册：`ctx.provide(name, ...)` / `Service` 构造（`service.ts:57`），按 `ctx.<key>` 查找而非 import 具体实现（`context.ts:42`「Root and child dependency containers」、`cordis-primer.zh.md`「上下文是服务的容器」）。
- dsh 内实例：`dsh-agent-loop` 声明「注入的服务：`agents`、`sessions`、`llm`、`tools`、`systemPrompt`：全部 5 个接口服务」（`@deepseek-ai/dsh-agent-loop/README.zh.md`「注入的服务」）。

**关键性质**：依赖是**声明**（`inject`），解析/等待/响应式重载是**框架职责**。新增一个插件不需要在别处「注册」它依赖谁——它自己声明，框架接线。这从机制上消灭了「定义了依赖但忘了在编排处登记」的故障类。

### harness/studio 现状

- harness 自身的 hook 机制是**平铺名称注册表**，无依赖声明：`HookRegistry` 是 name→`HookDefinition` 的 `Map`（`src/hooks/registry.ts:9-27`），`HookPipeline` 按 phase（before/after）+ priority 排序执行（`src/hooks/pipeline.ts:30-58`），hook 之间无依赖关系表达。
- studio 侧的接入是**手工列表**：`registerAllHooks()` 把 7 个 hook 函数逐个 `toHookDef(name, phase, fn, blocking)` 写进数组再 `registry.registerAll(hooks)`（`studio/packages/studio-shared/src/harness/hooks/register.ts:24-44`）。
- 「定义了没注册」是**已确认的真实故障类**，靠一条规矩兜底而非机制消除：`studio/.harness/custom-constraints.yml` 第 5 条 `hook_must_be_registered`（guideline）：「新增 harness hook 函数必须在 registerAllHooks()（hooks/register.ts）中注册，否则不会被管线调用。hook 定义不注册 = 死代码。」——这条规矩的存在本身就是「机制缺失、只能靠人记」的证据。
- 对照：harness 的 **checker 注册表已是「注册表闭环」**——ADR-0001「注册表闭环——引用未注册 checker id 构建报错」（`docs/adr/0001-constraint-system-rearchitecture.md:38`），README「check 层每条必须带真实 checker（注册表闭环，引用未注册 checker 构建报错）」（`README.md:61`）。同一故障类在 checker 侧已被机制消灭，在 hook 侧仍是 prompt 规矩。

### 可借鉴设计点 + 采纳建议

- **可借鉴**：harness 已有「注册表闭环 + 构建期校验」的成熟模式（checker），把它**推广到 hook** 即可消灭 hook 的「定义了没注册」——最简方案不是引入 Cordis DI，而是让 `registerAllHooks` 不再手工列表：hook 定义模块自注册（导出时 `register()`），或由「全量 import + 完整性断言」的测试/构建步骤保证「每个 `hooks/*.hooks.ts` 导出的 hook 都出现在注册表里」，漏注册 → 构建/测试失败。
- **不借鉴**：完整 Cordis `inject` + 服务容器 + 响应式重载。harness 的 hook 数量少（7 个）、依赖关系简单（无 A 依赖 B 的拓扑）、且 harness 不是常驻服务容器。为「顺序编排」引入 DI 容器成本远高于收益。
- **代价与收益**：低代价（复用既有 checker 闭环模式）；收益 = 删掉 `hook_must_be_registered` 这条 prompt 规矩，把故障类从「靠人记」变成「构建期报错」。**建议：有条件采纳（轻量，不引依赖）**，可作为 #82 D4 checker 接入的伴生重构（checker 也要挂守卫链，同样存在「定义了没挂」风险）。

---

## 3. checker/守卫作为插件（工具执行管线 vs completion-gates 硬编码链）

### dsh 机制

dsh 的审批/沙箱/超时/日志**不是 agent loop 内硬编码**，而是各自作为插件挂到一条工具执行管线上。管线顺序（master `docs/tool-execution-pipeline.md` 的 Mermaid 图 + `@deepseek-ai/dsh-tools/README.zh.md:5`）：

```
tools/pre-execute (waterfall: hooks/权限/沙箱) → 已注册单调守卫 → ctx.approval 一次性询问
→ tools/execute (waterfall: 超时/重试/指标，环绕分发) → 工具 execute() 主体
→ tools/post-execute (接受/阻止/替换/附加上下文) → finalizeContent → tools/result (仅观测)
```

- 扩展点语义（`dsh-tools/README.zh.md:57-60`）：`tools/pre-execute` 是**可重排的允许/拒绝/询问门禁**；`ctx.tools.guard(guard)` 在其后注册**单调守卫**（返回理由则拒绝，返回 `undefined` 则放行，后续 waterfall 不能把拒绝改回允许）；`tools/execute` 是**环绕分发包装层**（超时/重试/指标）；`tools/post-execute` 检查/替换结果、附加上下文；`tools/result` 仅观测。
- 具体能力全部是插件：审批是 `ctx.approval` 服务 + `approval/request` waterfall（`docs/subsystems/approval.zh.md`，`ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`，fail-closed）；沙箱是 `ctx.sandbox`/`ctx.sandboxPolicy` seam（`docs/subsystems/sandbox.zh.md`，`SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'`，逐调用策略）；超时是 `@deepseek-ai/dsh-tool-call-timeout-policy` 包装层（`dsh-tools/README.zh.md:195`）。
- agent loop 只负责「调用模型、运行工具、重复」，其余都归插件（`dsh-agent-loop/README.zh.md:76`），并明示挂载点（`:80`）：「沙箱、权限、计划模式：使用 `tools/pre-execute` 提供可扩展的拒绝/询问，使用 `tools.guard()` 提供单调拥有方策略，使用 `tools/post-execute` 处理结果决定，并使用 `tools/result` 进行最终观测」。

**关键性质**：守卫/审批/沙箱/超时是**同一类「管线监听器/守卫」的插件**，通过事件（waterfall/guard）挂载、随插件卸载自动摘除；loop 只发事件，不知道也不关心有哪些守卫。

### harness/studio 现状

- completion-gates 是**硬编码的 3 条守卫链**（`studio/apps/api/src/modules/agents/loop/completion-gates.ts:94-207`）：`runCompletionGuards` 依次跑「§10.5 提交守卫 → §6-2 子任务守卫 → B3b-i 自动验证守卫」，每条是一个独立 if 块，顺序即优先级（`completion-gates.ts:84-93`），降级/提示/计数/台账逻辑与守卫本体耦合在同一函数内。
- #82 D4 已定 checker 接入点 = 这条链：「checker 调用形态 = 进程内 import（复用 harness/runtime.ts 的 loadHarness() 懒加载单例），作为 runCompletionGuards 链上的新守卫被 await」（issue #82 Decisions D4）。即：**新增 checker = 在 `runCompletionGuards` 函数体里再加一段 if**。
- #82 D3 的软→硬语义复用「verify 守卫全家桶」（降级 progress + hint + 计数 ≥3 转 blocked + attestations 台账）。

### 可借鉴设计点 + 采纳建议

- **可借鉴**：dsh 的「守卫接口 + 注册表 + 声明式顺序 + 可独立开关」是对 completion-gates 现状最直接的低成本升级。三条守卫抽成统一 `CompletionGuard` 接口（`(ctx, deps) => { action, guardUpdates, notices }`）+ 守卫注册表，`runCompletionGuards` 从「手写 if 串」变成「遍历注册表按 order 执行」；checker 以「注册一个守卫」接入而非「在函数体追加 if」。这与 #82 D4「复用 completion-gates 现成语义」完全一致，且顺带消灭「新增守卫要手改函数体」的硬编码点。
- **不借鉴**：事件总线 + 服务 DI + 插件热插拔/动态卸载。studio 的守卫是**步收尾的确定性检查**（D1：步内无进程内拦截点，agent 是 spawn 的 CLI 子进程），不需要动态组合或运行时装卸；引入 Cordis 式事件系统对 3+N 条守卫是过度设计（也与 harness 自身 `simplest_solution_first` 约束冲突）。
- **代价与收益**：中低代价（重构 completion-gates + 适配单测）；收益 = 守卫可独立测试/开关/排序，checker 接入点统一。**建议：有条件采纳**，作为 #82 D4 checker 接线时的伴生重构，不单独立项。

---

## 4. Code Mode（run_code 工具 SDK 化 vs studio token 经济）

### dsh 机制

Code Mode 让模型**写一段程序、一次调用完成多步工具操作，中间过程不回灌上下文**：

- 传输形态（`@deepseek-ai/dsh-tools/README.zh.md:116-125`）：`mode: code` 下注册表暴露保留的 `run_code` 传输 + 按 `ctx.codeRuntime.language` 确定性生成的 SDK（TypeScript `tools` 命名空间 / Python `tools` 对象）。`code` 模式下模型直呼其他工具名会在 `tools/pre-execute` 之前就解析为 `UNKNOWN_TOOL`（`:120`）。
- 中间结果不回灌：SDK 说明原文「ONLY what you print or return comes back to you — intermediate tool results never enter the conversation, so extract just what you need.」（`dsh-tools/README.zh.md:163`）。
- 每次子调用仍走**完整工具管线**：`每个无损 JSON 绑定调用都会在原生调度约定下重新进入完整工具流水线（并发安全的调用最多可重叠 maxParallelSubCalls 个……）`，失败以程序可见的 `ToolCallError` 拒绝（`:118`）；「经过完整的 pre-execute → guards → execute → post-execute → result 流水线」（`:123`）。——即 Code Mode 省的是**模型上下文里的中间结果**，不是**绕过审批/沙箱/超时**。
- 代码执行是**可选 seam**：`ctx.codeRuntime` 抽象服务（`docs/subsystems/code-runtime.zh.md`），首个提供方是 Node worker-thread 后端（`@deepseek-ai/dsh-code-runtime/README.zh.md`），运行时「不了解工具或会话」，只接受「具名异步函数 + 程序字符串」。
- 设计理由与成本边界：SDK 段「输出具有确定性……工具集合不变时，文本逐字节相同（有利于前缀 cache）」（`:122`）；但 token 影响一节明言「Code Mode 使用生成的 SDK 文本加一个传输 schema 取代最终工具 schema，但**不承诺普遍减少成本**」（`:170`）。

### harness/studio 现状

- studio agent 是 spawn 的第三方 CLI 子进程（Claude Code / claude），文本协议事后解析（#82 D1：「步内无进程内拦截点（agent 是 spawn 的 CLI 子进程，文本协议事后解析）」）。这决定了 studio **无法控制** CLI 的上下文窗口与中间工具结果回流。
- token 教训已有记录：#82 Notes「08-03 烧 token checker 挡不住（单次行动均合规）」——即 token 浪费发生在**单次行动合规但累积烧钱**的层面，checker（微观执法）拦不住，需要宏观观测（#82 分工框架）。

### 可借鉴设计点 + 采纳建议

- **可借鉴**：不是 `run_code` 本身，而是「**批处理 + 中间结果不回流**」的设计逻辑——把多次原子工具调用聚合成一次子任务/批量命令，只把聚合结果摘要回流主线，减少主线上下文里的工具中间结果。studio 在 WU 步骤编排层已有 subagent/batch 通道，可作为该逻辑的落点。
- **不照搬**：`run_code` + code-runtime seam 依赖 dsh 自研 agent loop（code-runtime 是 loop 的可选能力），studio 的 agent 在第三方 CLI 内部，无法把「模型交一段程序」这件事塞进 CLI。且 dsh 自己的文档都声明「不承诺普遍减少成本」——它省的是中间结果 token，固定成本（SDK 段 + 传输 schema）仍在。
- **代价与收益**：照搬实现 = 高代价（需自研 agent loop 才能承载，与 studio 现有 CLI 派发架构冲突）；借鉴思路 = 低代价。**建议：有条件采纳（仅思路，低优先级）**；token 经济的更直接杠杆是 compaction/预算（dsh 自身的 compaction 机制、studio 已有的 session-compression），而非 Code Mode。

---

## 5. Agent Preset（vs studio role/profile）

### dsh 机制

- preset 定义（`@deepseek-ai/dsh-agent-presets/README.zh.md`）：**preset 是一个目录，内放一份 `agent.cordis.yml`（Cordis 插件行列表）**。roster 进程内只挂载一次（常驻 scope），每个会话把自己 agent 的 scope key 认父到该挂载；工具/提示词段落/投影单元只存一份。
- 分层与遮蔽：agent 视图按 `agent → preset → global` 解析（近者遮蔽远者），挂载监听器只对认父到它的 agent 放行。
- 差异化能力 = **不同插件组合**：架构文档「让某个会话拥有不同的能力集合：组装一个 agent preset；其中的服务行需要 `isolate` realm」（`docs/architecture.zh.md`「新行为的归属位置」表）；工具呈现模式可 per-agent 选择（`dsh-tools/README.zh.md:17`）。
- 组装点：仅 agent 工厂的 `setup(agentCtx)` 钩子；`recompose` 仅限「尚无产出」的空白 agent。

### studio role/profile 现状

- studio 的 role/profile 是**数据 + prompt 文本**，不是插件组合：`AgentProfile` = name/description/channels/provider/persona/acceptedTypes（+ `#91` 补 skills/tools/constraints）（`studio/apps/api/src/modules/agents/agent-profile.service.ts`）。
- `loadRolePreset(preset)` 读 `.agents/roles/<preset>.yaml`，得到 `RolePreset = { description, persona, acceptedTypes, skills, tools, constraints }`（`agent-profile.service.ts:loadRolePreset`），其中 `persona` 进 prompt「## 你的角色」段，`tools`/`skills` 是**名称列表**（`#91` 注释：「此前读取即丢弃，prompt 组装无从消费」）。

### 异同 + 采纳建议

- **同**：都是「命名的差异化加载单元」，都决定提示词 + 工具集 + 执行策略，都有「空白/预设」之分。
- **异（关键）**：dsh preset 组合**可执行插件**（真实工具注册、prompt 段 provider、service），类型化、可校验、按 scope 隔离；studio role 是**纯文本 + 名称列表**，渲染进 prompt 后由第三方 CLI 消费——声明 `tools: [...]` 无法验证该工具是否真的对角色可用，本质仍是「prompt 建议」而非「能力注册」。
- **建议**：**有条件采纳（低优先级）**。studio role 已覆盖「差异化提示词/工具集加载」的需求；要升级为 dsh 式「能力级 scope 分层 + 近者遮蔽」，前提是 studio 拥有**进程内可拦截的 agent 回路**（#138 步内前置拦截 / #53 checker 接 agent-loop 落地后才有进程内执行面），且工具由第三方 CLI 提供使 scope 隔离无法穿透 CLI。短期保持 role 现状，只在自研回路成熟后再评估「能力注册式 profile」。

---

## 6. 许可证 / 依赖风险

核实结果（均为命令验证，非凭记忆）：

- **LICENSE = MIT**：master `LICENSE` 原文「MIT License, Copyright (c) 2026 DeepSeek」（https://github.com/deepseek-ai/deepseek-harness/blob/47f9438/LICENSE ）；本机各 `@deepseek-ai/*` 包的 LICENSE 同为 1065 字节 MIT；README 另列 `THIRD_PARTY_NOTICES.md`（其内容本次未逐条核对）。
- **dsh 是 developer preview**：README.zh「DeepSeek Harness 目前处于 _开发者预览_ 阶段……**未来将出现破坏兼容性的变更。**」；英文原文「THERE WILL BE COMPATIBILITY-BREAKING CHANGES.」。版本 `0.1.0-rc.6`（本机）/ `0.1.0-rc.5`（master 锁定 release）。
- **Cordis 成熟度**：`cordiverse/cordis` 3307 stars、`pushed_at` 2026-08-13（活跃），但 README 明示「Cordis is under active development. **The API is not yet stable and may change without notice.**」；dsh 内 vendor 的 `@deepseek-ai/cordis@4.0.1` 是 cordis 的分支（`package.json` repository 指向 `vendor/cordis`）。论文是 preprint（「under active revision」）。

**结论**：借鉴设计 ≠ 引入依赖。MIT 无许可障碍；但 dsh（developer preview、破坏性变更）与 Cordis（API 未稳定）都不满足 harness 作为「稳定约束框架 + 供第三方项目依赖」的定位要求。本报告 1-5 节的所有可借鉴点（dispose 纪律、声明式依赖/注册表闭环、事件化守卫管线、批处理思路、能力分层）均可在 harness 现有 TypeScript 栈内自研落地，**无需引入 cordis/dsh 任何运行时依赖**。

---

## 借鉴产出形态建议

issue #140「Not yet specified」要求给建议但把最终决定留给 issue。建议如下（按成本递增排序）：

1. **逐条进 #82 邻接实现票（推荐主路径）**：
   - Q3 守卫注册表化 → 挂进 #82 D4 的 checker 接线（completion-gates 重构为守卫接口 + 注册表），随 checker 实现一并落地。
   - Q2 hook 注册表闭环 → 作为 Q3 的伴生（checker 也面临「定义没挂」风险），或单独一张小实现票。
   - Q1 可逆 effect 建模 → 挂进 #82 D6「进化提案落地通道」的「变更草案」实现，作为提案记录的 inverse diff 字段。
2. **ADR（仅当要固化框架级原则时）**：若决定把「harness 的注册型能力一律走『注册表闭环 + 构建期校验』」上升为跨模块约定（checker 已如此，hook/守卫/门禁尚未统一），可写一条 ADR 固化；否则不写——Q2/Q3 是既有模式的推广，够不上新架构决策。
3. **不单独立设计提案票**：本调研无独立实现内容（全部是既有模式的借鉴/推广），单独立票会造出无产出的空票；把它当作 #82 的邻接依据即可。

最终决定（ADR / 提案票 / 逐条邻接票）留待 issue #140 定夺。

---

## 未能核实的点（诚实声明）

1. **Cordis 论文全文**：只读了 `cordiverse/paper` 的 README 摘要（时间/空间组合性定义 + revertible effect/reactive coeffect 表述），未读 `paper.pdf` 正文的形式化定义与演算；摘要之外的数学细节**未核实**。
2. **master 仓库完整树**：因 github.com 网络不可达，未 clone 完整仓库；`.agents/notes/**`（Agent Note，各 README 大量引用）**未逐篇读取**，本报告仅把它们当作「被 README 引用」的事实标注路径，不引用其内容。
3. **THIRD_PARTY_NOTICES.md**：仅确认其存在（README 提及），未逐条核对第三方依赖许可证清单。
4. **cordisjs/cordis → cordiverse/cordis 重命名**：经 GitHub API 确认 `cordisjs/cordis` 重定向到 `cordiverse/cordis`（同一仓库、同一 stars/pushed_at），但未考证重命名时间与历史语境。
5. **本机 rc.6 与 master rc.5 的差异**：确认本机 `@deepseek-ai/dsh@0.1.0-rc.6` 略新于 master 锁定的 rc.5 发布，但未逐文件 diff 两者差异；本报告以 master 文档为准、本机源码仅作行级证据。
