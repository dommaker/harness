# monitoring/

## 职责
运行时监控：Execution Trace（收集/分析）+ 上下文使用追踪。

## 核心导出
- `TraceCollector` — 执行追踪收集（append-only JSONL，`.harness/logs/traces.log`）
- `TraceAnalyzer` — 追踪统计分析 + 异常检测（共用 analyzer-base 纯函数）
- `ContextTracker` — LLM 调用上下文使用快照记录

## 依赖关系
- 依赖 `src/types/trace` ExecutionTrace 类型
- 被 `src/core/constraints/checker`（惰性接线 getTraceCollector，ADR-0003）与 `src/cli/` 命令消费

## 约定
- Trace 文件存储在 .harness/ 目录（不提交）
- 追加写入，单行 JSON，自动滚动
- 零 Token 成本：不调用 LLM

## 注意事项
- 追踪数据供 `harness constraints report` 统计与退役候选诊断消费（观测用途，不做自动降级）
- ADR-0003 起移除 recordBypass 链（绕过观测后续单独立项）与断链的诊断/性能/知识医生文件
