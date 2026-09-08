# ADR-0020: TraceAnalyzer 纯判定下放为模块级函数，类壳保留（架构评审候选4）

- 日期：2026-09-08
- 状态：已接受
- 影响版本：下个 minor（无 breaking；包根导出零扩张，ADR-0003 不动）
- 关联：架构评审 2026-09-08 候选4（grilling 决策树已走完）；analyzer-base.ts 先例（纯函数模块形状）；harness#100（readReport 报告入口）

## 背景

`TraceAnalyzer` 的判定方法里，`summarize(traces)` 与 `detectAnomalies(summaries)` 是纯数据进出（不碰 `this.collector`；skip-semantics.test.ts:302 用 `new TraceAnalyzer(null as any)` 调 summarize 即为实证）。但纯判定挂在有状态类上，消费端被迫做 IO 仪式：

- `status.ts:66-67` 为调这两个纯函数必须 `new TraceCollector({traceFile})`——其构造函数 `ensureDirectory()` 有 mkdir 副作用（traces.ts:52-63）；status.ts:61 的数据本是 `readJsonl` 直读的，collector 实例仅作构造参数，读方法从未被调用。
- 测试端代价：`status.test.ts` / `status-extra.test.ts` 各 mock 掉 TraceAnalyzer（+fs+chalk 分层）才能断言，合计 18 处 mockImplementation。

事实核查修正了评审报告的假设：studio **运行时**消费 TraceAnalyzer（runtime.ts:70 `new TraceAnalyzer(c)`，路由调 `analyzeRecentReport` + `detectAnomalies`）——类壳必须保留，不是只用类型。

## 决策

1. **`summarize` / `detectAnomalies` 提为 `trace-analyzer.ts` 的模块级纯函数**（与类同住：它们依赖 `TraceAnalyzerConfig` 类型，不搬去 analyzer-base 避免工具模块变大杂烩）。签名不变（数据进数据出），config 经参数传入。
2. **类壳保留并改为转发**：`TraceAnalyzer` 的方法本体改为调模块级函数——studio 经类消费的面（`analyzeRecentReport`/`detectAnomalies`）逐字不动。
3. **status.ts 直调纯函数**：删掉 `new TraceCollector` + `new TraceAnalyzer` 仪式，mkdir 副作用退出该路径；status 两套件对 TraceAnalyzer 的 mock 随迁删除（fs mock 按需保留）。
4. **`compareWithPrevious` / `generateReport` 不动**（无外部消费痛点）；`analyzeRecent*` / `analyzeConstraint`（两段式：collector 读 + 纯算）与 saveSummary/runHourly*（文件副作用）保持类方法。
5. **纯函数不进包根导出**（ADR-0003 零扩张）：仓内消费经相对 import，非 breaking，不跟 2.0.0 的车。

## 理由

- **复杂度不在函数里，在调用方式里**：为两个纯函数构造带 mkdir 副作用的 collector，是无 locality 的典型形状；下放后调用点与测试都打在纯函数 interface 上。
- **一个 adapter 是假想 seam**：analyzer 的 collector 依赖在 status.ts 场景根本不读数据——seam 没有实际变化跨过它，不该让消费端为它付构造与 mock 成本。
- **类壳转发而非删除**：studio 是真实运行时消费者（事实核查修正后），保留类壳让本票变成纯内部重构、零跨仓协调。

## 影响

- 代码：`monitoring/trace-analyzer.ts`（两个模块级函数 + 类方法改转发）、`cli/commands/status.ts`（直调）。
- 测试：status 两套件去 TraceAnalyzer mock；纯函数的行为断言由既有 trace-analyzer 测试经类壳继续覆盖（转发后路径相同），新增两枚直调纯函数的用例钉住模块级 interface。
- 公开面：零变化。studio：零影响。
