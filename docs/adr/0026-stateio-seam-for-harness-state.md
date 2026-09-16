# ADR-0026: 新立 StateIO 接缝收编 `.harness/.state.json` 的读写——`RunEnv` 只读契约不动（harness#140 C 票 / #148）

- 日期：2026-09-16
- 状态：**已接受**（当人面确认，2026-09-16）；本篇只冻结决策，**代码未落**——实现见 harness#148 步骤 2
- 影响版本：行为纠偏一处（智能提示的去重从此真的生效）+ 包内新增接缝（不进包根导出面）→ 建议按 **patch/minor** 定级，随发布裁。
- 关联：harness#148（本 ADR 的来实现票）；harness#140（母票，三处「verifier 自己找文件」之三）；ADR-0023（`RunEnv` = 一次 check 的运行级**只读**快照，本 ADR 明确不动它）；ADR-0018 / ADR-0022（零生产者/零消费者面按删除处理）；`src/cli/command-contract.ts`（`CommandIO` 注入模式，本 ADR 照其形状但**不扩它**）

> **编号说明**：票面与 `src/CONTEXT.md:50` 原写「ADR-0024」，该号已被同批 #135 占用、0025 被 #142 占用，故本篇一改为 0026。`src/CONTEXT.md` 那条已随本篇同一 commit 更正。

## 背景

`.harness/.state.json` 有两个写者，都是 async 命令里裸调同步 `fs`，无注入缝，测试只能碰真文件系统。把两处代码逐行核过之后，实际情况比票面记的更糟——**两个写者不是"各自为政"，是后者无条件覆盖前者**：

| 位置 | 读 | 写 | 写的形状 |
|---|---|---|---|
| `src/cli/commands/check.ts:245-283`（`getSmartHint`） | `existsSync` + `readFileSync`（`:265-267`） | `mkdirSync` + `writeFileSync`（`:279-281`） | 读到的整个对象 + `shownHints.push(...)` 后整体写回 |
| `src/cli/commands/status.ts:35,143-147` | **不读** | `mkdirSync` + `writeFileSync`（同形） | 只写 `{ lastStatusRun }` 一个新对象 |

后果是一条可复现的行为缺陷：`status` 每次运行都把 `.state.json` 整个重写成只含 `lastStatusRun` 的对象，`check` 写进去的 `shownHints` 随之消失。于是「记录已足够，运行 harness status 查看统计」这条提示的**去重机制被第二个写者打掉**——用户照提示跑一次 `status`，下次 `check` 时 `shownHints` 已空，提示再出。提示设计上写的是「首次达到阈值」（`check.ts:272` 的 `!state.shownHints.includes('trace_50')`），实面是「每两次 `check` 夹一次 `status` 就再响一次」。

顺带核出第三个事实：类型声明里的 `lastDiagnoseRun`（`check.ts:263`）**全仓零生产者、零消费者**（`grep -rn lastDiagnoseRun src` 只命中这一行声明），是一枚凭想象留下的字段。

而这套读写之所以一直是裸 `fs`，是因为没有任何一面能供给它：`RunEnv`（ADR-0023）是**只读**观察面，标题即契约，往里加写口等于改掉那条 ADR；`CommandIO`（`command-contract.ts:37-40`）只有 `stdout`/`stderr`，是输出面。

## 决策

### 1. 新立 `StateIO` 接缝，两方法，落 `src/cli/` 层

```ts
/** harness 自身运行期状态文件的可注入接缝（读-改-写的唯一入口） */
export interface StateIO {
  read(): HarnessState;          // 文件缺失/空 → {}；损坏 → 现状语义（见决策 4）
  write(state: HarnessState): void;
}
```

- `HarnessState` 从 `check.ts` 的内联类型提出来成为具名类型，字段 = `shownHints?: string[]` + `lastStatusRun?: string`；**`lastDiagnoseRun` 删除**（零生产者零消费者，按 ADR-0022 口径；已落盘的旧文件里残留该键无害，不做迁移）。
- 落点 `src/cli/`（两个消费者都在 cli 层）：不进 `core/`，不进 `src/index.ts` 导出面，因此零公共面变化。
- 默认真实 fs 实现 `fileStateIO`，命令函数加**可选**注入参数（照 `CommandIO` 的 `io: CommandIO = processIO` 模式）。**不扩 `CommandIO`**——输出面与状态面是两个概念，合并会让"能不能测输出"和"能不能测状态读写"耦在一起。

### 2. 两个写者同票收编，且写语义改为读-改-写

只接一个等于留半张票：接缝的价值全在"同一份文件的读写只有一个入口"，接一半则覆盖问题原样存在。

- 写路径统一为 `write(merge(read(), patch))` 形状，`status` 不再整文件重写。
- 这一条即上述行为缺陷的修复：`shownHints` 从此真的能跨 `status` 存活，智能提示恢复「首次达到阈值」的语义。**属对外可见行为变化**（提示出现频次变少），须在 CHANGELOG 记名并定级。

### 3. 一次运行内同一口径至多读一次，用计数闸钉

形状照 `src/cli/commands/__tests__/check-read-count.test.ts`：整张读取表逐条冻结。`check` 一次运行内 `state.json` 的读次数 = 1（当前最坏 1 读 1 写；收编后不得变成 2 读）。反证：把某处绕回裸 `fs.readFileSync` → 计数测试转红。

### 4. 不动的东西

- `RunEnv`：只读快照契约保持原样（ADR-0023）。状态文件是 harness **自身**的运行期状态，与 `RunEnv` 观察的**项目上行数据**不是一类东西，owner 不同——这是当初否掉「顺手扩 `RunEnv`」的真正理由，不只是"标题写了只读"。
- `CommandIO`：输出面不动。
- `.state.json` 的路径与 schema 键名（除删 `lastDiagnoseRun`）：不做迁移、不改路径。
- 状态文件损坏时的容错策略：保持现状（`JSON.parse` 抛即抛，不兜底成 `{}`）——`#140` 未裁这条，本 ADR 不顺手改。

## 否掉的备选

| 备选 | 否掉的理由 |
|---|---|
| 扩 `RunEnv` 加 `writeState()` | 破 ADR-0023 的只读契约；且 `RunEnv` 只在 `check` 一侧构造，`status` 命令拿不到它 |
| 扩 `CommandIO` 带状态读写 | 输出面与状态面耦合；`CommandIO` 现有 30+ 注入点全部要跟着动 |
| 两命令各自 memo 状态文件 | 治不了跨命令覆盖写（问题在写语义，不在读次数），且留下两份读逻辑 |
| 只接 `check` 一侧（半张票） | `status` 的覆盖写原样保留，接缝宣称的单一入口不成立 |

## 影响

- 实现票 harness#148 步骤 2 按本篇落地；落地后 `src/cli/commands/` 下对 `.state.json` 的裸 `fs` 调用应为 0（grep 可证）。
- 对外行为变化 1 处：智能提示去重生效（`shownHints` 不再被 `status` 抹掉）。
- `src/CONTEXT.md:50` 的 StateIO 条目从「已定方向、未落码」改为已落地口径，并把该行的「先出 ADR-0024」一并更正。
- 母票 #140 收口条件达成（三处全部落地）。
- 消费方影响：无。`shownHints`/`lastStatusRun` 均为 harness 内部状态，studio 侧不读该文件（#148 实施前须复核这条断言）。
