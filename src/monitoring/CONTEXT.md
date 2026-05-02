# src/monitoring

监控模块 — 执行追踪、性能监控、约束诊断和演化提案。

## 职责

- `traces.ts` — TraceCollector（轻量收集）+ TraceAnalyzer（统计汇总、异常检测）
- `ConstraintDoctor` — 约束诊断器，支持可选 LLM 深度分析（注入 LLMAdapter，~2000 Token/次，失败自动降级到规则诊断）
- `ConstraintEvolver` — 约束提案流程，生成约束变更建议
- `PerformanceCollector` / `PerformanceAnalyzer` — 性能日志收集和分析

## 核心导出

- `TraceCollector`, `TraceAnalyzer`
- `ConstraintDoctor`（可选注入 `LLMAdapter` 实现深度诊断）, `ConstraintEvolver`
- `PerformanceCollector`, `PerformanceAnalyzer`

## 依赖关系

- 被 `src/index.ts` 导出
- `ConstraintDoctor` 可选依赖 `src/llm/adapter.ts` 的 `LLMAdapter` 接口
- 输出存储在 `.harness/traces/` 和 `.harness/performance/`（append-only JSONL）
- `ConstraintEvolver` 的提案可被 `src/constraints/lifecycle-runner` 执行

## 注意事项

- 追踪记录必须使用 `ExecutionTrace` 类型
- 核心监控是零 token 的纯文件操作；LLM 深度诊断为可选增强（需显式启用）
- JSONL 文件自动滚动，防止单文件过大
