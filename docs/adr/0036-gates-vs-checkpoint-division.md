# ADR-0036: gates 与 checkpoint 两套机制的分工与术语裁决

- 日期：2026-09-28
- 状态：已接受
- 关联：harness#187（裁决单，grilling 定案）；ADR-0002（gates 注册表闭环）；harness#115（runGates 复开点）；ADR-0031（第一性定位）；studio#644（触发方）

## 背景

仓内并存两套「门禁」机制，2026 年 4 月项目初期相隔两周各自长出，从未有工单裁决过两者关系：

- **checkpoint**（`src/core/validators/checkpoint.ts` + `harness validate` CLI + `.harness/checkpoints.yml`）：初始提交即有，数据驱动的通用检查（13 种 check type），消费方众多（validate CLI、init 生成的 CI 模板、pre-push hook、studio）。
- **gates**（`src/gates/`，6 gate + registry + runGates）：代码写死的成品质量检查，统一三态决策协议（deny/abstain/ask），消费面为 6 个 CLI 命令与 studio-agent 的 CommandGate；链式执行面 runGates 按 harness#115 裁决刻意无生产消费者，留作复开点。

混同已落到文档：README 曾把检查点列为「第 8 种门禁」；`checkpoint.ts` 头注释自称「编排层」，与 ADR-0031「harness 不做生产编排」冲突。外部使用方（studio#644）说「收敛到 harness 门禁框架」时无权威答案可指。

## 决策

1. **并存分工，不合并不废弃。** 本次只动文档与注释，不动代码行为。
2. **术语裁决**：
   - **门禁（gate）**：仅指 `src/gates/` 注册的 6 个代码实现的成品质量检查（验收/命令/契约/性能/审查/安全），harness 作为标准提供，统一三态决策协议。
   - **检查点（checkpoint）**：项目在 `.harness/checkpoints.yml` 里自己声明的通用验证项（13 种 check type），由 `CheckpointValidator` / `harness validate` 执行。
   - 判定尺：**这检查是项目自己在配置里张罗的通用项，还是 harness 作为标准发给你的代码成品？** 前者检查点，后者门禁。
3. **checkpoint 定位改写**：自「编排层」改为「查落实工具」（ADR-0031 四件事之一），`checkpoint.ts` 头注释同步。其自述「编排层」为项目初期历史话术，实际消费形态是 CI 检查与下游验证。
4. **落点**：根 `CONTEXT.md` 术语表（新建）、README 修正（validate 注释与能力表）、`src/gates/CONTEXT.md` 注记、`checkpoint.ts` 头注释；studio#644 回链本 ADR 作为「该用哪套」的权威答案。

## 否决的备选

- **合并两套**：被否决。形态不同（配置声明 vs 代码实现）、决策模型不同（过/不过 vs 三态），合并两头受损，且无消费方提出链式需求。若将来出现「多道门串成链跑」的真实消费方，可重审合并方向——runGates 与 `order` 字段即该复开点（harness#115 裁决维持不变）。
- **废弃其一**：被否决。两套均有活消费方，砍任何一套都是真实破坏。

## 影响

- 「该用哪套」有权威答案：studio#644 的收敛目标为 checkpoint 机制。
- 术语正本在根 `CONTEXT.md`，后续文档与注释用词以其为准；README「门禁」字样仅指 gates。
