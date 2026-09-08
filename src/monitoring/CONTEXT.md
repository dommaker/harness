# monitoring/

## 职责
运行时监控：Execution Trace（收集/分析）+ 上下文使用追踪。

## 核心导出
- `TraceCollector` — 执行追踪收集（append-only JSONL，`.harness/logs/traces.log`）。读入口两个：`readReport(filter?)` 报告入口（返回 `{ traces, skippedLines }`，harness#100）与 `read()/readRecent()/readByConstraint()` 兼容包装（#82 裁决 4 冻结的签名，丢计数）
- `TraceAnalyzer` — 追踪统计分析 + 异常检测（共用 analyzer-base 纯函数）。`analyzeRecentReport(hours)` 带坏行数，`analyzeRecent()/analyzeConstraint()` 仍返回 `TraceSummary[]`。**ADR-0020**：`summarize`/`detectAnomalies` 的判定本体是 trace-analyzer.ts 的模块级纯函数 `summarizeTraces(traces)` / `detectTraceAnomalies(summaries, config?)`（阈值经参数传入，不再是实例状态），类壳只转发——类壳是 studio 的运行时消费面（`new TraceAnalyzer(c)` + `analyzeRecentReport`/`detectAnomalies`，签名逐字不动），已持有数据的消费端直调纯函数。两函数**不进包根导出**（ADR-0003 零扩张），仓内经相对 import
- `ContextTracker` — LLM 调用上下文使用快照记录

## 依赖关系
- 依赖 `src/types/trace` ExecutionTrace 类型
- 消费者：`src/cli/commands/{check,report}` 与 `src/hooks/bootstrap`——组合根经 `getTraceCollector()` 把收集器注入 `ConstraintChecker` 构造参数（harness#88）；`status` 按 projectPath 直读读链正本后**直调模块级纯函数**，不构造 collector/类壳（ADR-0020：collector 构造函数的 mkdir 副作用就此退出该路径）
- core 不再依赖本模块（方向由 eslint no-restricted-imports 锁死，`src/__tests__/layering.test.ts` 守卫）

## 约定
- Trace 文件存储在 .harness/ 目录（不提交）
- 追加写入，单行 JSON，自动滚动
- 零 Token 成本：不调用 LLM
- **凡以 `skip` 策略读 JSONL，坏行计数必须到达该消费面的用户可见输出，或在该调用点显式记名豁免并写明理由（harness#100）**——静默吞掉「数据不全」不是一种可选项。承载方式纯增量：新报告入口带计数，旧入口退化为丢计数的薄包装（#82 裁决 4 的兼容约束继续成立），不另立第二份计数概念、不把 `JsonlReadResult` 提升进包根（ADR-0003）
  - 机器可检：`src/utils/__tests__/jsonl-skip-disposition.test.ts` 三道闸——每个 `readJsonl` 调用点必须判得出策略（判不出即形状逃逸，失败）、skip 读点集合冻结（新增未声明即失败，站点消失却不删条目也失败）、每个读点上方 6 行内有 `计数去向：` 声明且邻居声明不得顶替
  - 三类去向（逐条对得上代码）：**报告体内部的降级位**随报告体走 stdout——`constraints report` 的坏行提示紧挨既有的 `traceFileExists` 说明；**不挤动既有输出的诊断告知**走 stderr——`status`（`logError`，stdout 的 `记录数` 口径与字节不变）、`failure list`（#96 定稿的 `console.error`）、`constraints retire`（交互与 `--yes` 直达两条路径各自告知）；**结构化面用字段**——`constraints report --json` 的 `skippedLines`、`--export` markdown 的警示行、studio 端点响应体（配套票 studio#451）

## 注意事项
- 追踪数据供 `harness constraints report` 统计与退役候选诊断消费（观测用途，不做自动降级）
- **坏行计数是文件级口径**：`tail`/`head` 截断与时间窗过滤都发生在 parse 之前/之上，坏行既没有 timestamp 也没有 constraintId 可归窗，因此 `readReport()`/`analyzeRecentReport()` 返回的 `skippedLines` 不受过滤影响。消费方**无法**用「原始行数 − 统计条数」反推（两者分不开被窗过滤掉的合法行与损坏行），必须读 harness 透传的计数（#100 写死这条）
- ADR-0003 起移除 recordBypass 链（绕过观测后续单独立项）与断链的诊断/性能/知识医生文件
