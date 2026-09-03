# monitoring/

## 职责
运行时监控：Execution Trace（收集/分析）+ 上下文使用追踪。

## 核心导出
- `TraceCollector` — 执行追踪收集（append-only JSONL，`.harness/logs/traces.log`）
- `TraceAnalyzer` — 追踪统计分析 + 异常检测（共用 analyzer-base 纯函数）
- `ContextTracker` — LLM 调用上下文使用快照记录

## 依赖关系
- 依赖 `src/types/trace` ExecutionTrace 类型
- 消费者：`src/cli/commands/{check,report}` 与 `src/hooks/bootstrap`——组合根经 `getTraceCollector()` 把收集器注入 `ConstraintChecker` 构造参数（harness#88）
- core 不再依赖本模块（方向由 eslint no-restricted-imports 锁死，`src/__tests__/layering.test.ts` 守卫）

## 约定
- Trace 文件存储在 .harness/ 目录（不提交）
- 追加写入，单行 JSON，自动滚动
- 零 Token 成本：不调用 LLM

## 注意事项
- 追踪数据供 `harness constraints report` 统计与退役候选诊断消费（观测用途，不做自动降级）
- ADR-0003 起移除 recordBypass 链（绕过观测后续单独立项）与断链的诊断/性能/知识医生文件
