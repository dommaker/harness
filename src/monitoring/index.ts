/**
 * 监控模块导出
 *
 * Execution Trace 系统：
 * - TraceCollector：轻量收集，零 Token
 * - TraceAnalyzer：统计汇总，异常检测
 *
 * 上下文使用追踪：
 * - ContextTracker：LLM 调用上下文快照记录
 */

export { TraceCollector, getTraceCollector, configureTraceCollector, DEFAULT_TRACE_FILE } from './traces';
export { TraceAnalyzer, createAnalyzer } from './trace-analyzer';
export { ContextTracker } from './context-tracker';
export type { ContextAverages } from './context-tracker';
