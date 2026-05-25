# monitoring/

## 职责
运行时监控：Execution Trace(收集/分析/诊断)、Performance Trace(收集/分析)、约束进化提案、知识进化、上下文追踪。

## 核心导出
- `TraceCollector` — 执行追踪收集(append-only JSONL)
- `TraceAnalyzer` — 追踪统计分析 + 异常检测
- `ConstraintDoctor` — 约束诊断接口(Agent 消费)
- `ConstraintEvolver` — 约束进化提案流程
- `PerformanceCollector` — 性能日志收集
- `PerformanceAnalyzer` — 性能统计分析
- `ContextTracker` — 上下文追踪
- `KnowledgeDoctor` — 知识健康诊断
- `KnowledgeEvolver` — 知识进化引擎

## 依赖关系
- 依赖 `src/core/constraints/` 约束定义
- 依赖 `src/types/trace` ExecutionTrace 类型
- 被 `src/cli/` 命令消费

## 约定
- Trace 文件存储在 .harness/ 目录(不提交)
- 追加写入，单行 JSON，自动滚动
- 零 Token 成本：不调用 LLM

## 注意事项
- 追踪数据用于约束退化分析(拦截率 < 阈值 → 自动降级)
- PerformanceCollector 和 TraceCollector 独立运作
