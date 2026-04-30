/**
 * Performance Analyzer
 *
 * 纯计算，零 Token 成本
 *
 * 功能：
 * - 统计汇总（每小时自动执行）
 * - 异常检测（每日检查）
 * - 趋势分析（对比上一周期）
 *
 * 与 TraceAnalyzer 的区别：
 * - TraceAnalyzer: 分析约束检查结果
 * - PerformanceAnalyzer: 分析操作耗时
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PerformanceTrace,
  PerformanceSummary,
  PerformanceAnomaly,
  PerformanceAnalyzerConfig,
} from '../types/performance';
import { PerformanceCollector } from './performance-collector';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: PerformanceAnalyzerConfig = {
  summaryFile: '.harness/logs/performance-summary.json',
  periodMs: 3600 * 1000, // 1 小时
  thresholds: {
    avgDuration: 5000,     // 平均耗时 > 5s 视为异常
    exceededRate: 0.3,     // 超阈值率 > 30% 视为异常
    errorRate: 0.1,        // 错误率 > 10% 视为异常
  },
};

/**
 * Performance Analyzer
 *
 * 使用方式：
 * ```typescript
 * const analyzer = new PerformanceAnalyzer(collector);
 * const summaries = analyzer.summarize(traces);
 * const anomalies = analyzer.detectAnomalies(summaries);
 * ```
 */
export class PerformanceAnalyzer {
  private config: PerformanceAnalyzerConfig;
  private collector: PerformanceCollector;

  constructor(collector: PerformanceCollector, config?: Partial<PerformanceAnalyzerConfig>) {
    this.collector = collector;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成统计汇总
   *
   * 纯计算，零 Token 成本
   */
  summarize(traces: PerformanceTrace[]): PerformanceSummary[] {
    // 按操作类型分组
    const grouped = this.groupByOperation(traces);

    const summaries: PerformanceSummary[] = [];

    for (const [operation, group] of grouped) {
      // 计算时间范围
      const timestamps = group.map(t => t.timestamp);
      const timeRange = {
        start: Math.min(...timestamps),
        end: Math.max(...timestamps),
      };

      // 单次遍历计算核心统计
      const totalCalls = group.length;
      let okCount = 0, exceededCount = 0, errorCount = 0;
      for (const t of group) {
        if (t.result === 'ok') okCount++;
        else if (t.result === 'exceeded') exceededCount++;
        else if (t.result === 'error') errorCount++;
      }

      // 计算比率
      const okRate = totalCalls > 0 ? okCount / totalCalls : 0;
      const exceededRate = totalCalls > 0 ? exceededCount / totalCalls : 0;
      const errorRate = totalCalls > 0 ? errorCount / totalCalls : 0;

      // 计算耗时统计
      const durations = group.map(t => t.duration);
      const avgDuration = this.calcAverage(durations);
      const maxDuration = Math.max(...durations);
      const minDuration = Math.min(...durations);
      const p95Duration = this.calcPercentile(durations, 95);
      const p99Duration = this.calcPercentile(durations, 99);

      // 计算趋势
      const recentTrend = this.calculateTrend(group);

      summaries.push({
        operation,
        timeRange,
        totalCalls,
        okCount,
        exceededCount,
        errorCount,
        avgDuration,
        maxDuration,
        minDuration,
        p95Duration,
        p99Duration,
        okRate,
        exceededRate,
        errorRate,
        recentTrend,
      });
    }

    return summaries;
  }

  /**
   * 分析最近 N 小时的 traces
   */
  analyzeRecent(hours: number): PerformanceSummary[] {
    const traces = this.collector.readRecent(hours);
    return this.summarize(traces);
  }

  /**
   * 分析特定操作
   */
  analyzeOperation(operation: string): PerformanceSummary[] {
    const traces = this.collector.readByOperation(operation);
    return this.summarize(traces);
  }

  /**
   * 检测异常
   *
   * 基于阈值检测异常模式
   */
  detectAnomalies(summaries: PerformanceSummary[]): PerformanceAnomaly[] {
    const anomalies: PerformanceAnomaly[] = [];
    const thresholds = this.config.thresholds!;

    for (const summary of summaries) {
      // 检测高平均耗时
      if (summary.avgDuration > thresholds.avgDuration!) {
        anomalies.push({
          type: 'high_avg_duration',
          operation: summary.operation,
          message: `操作 ${summary.operation} 平均耗时 ${Math.round(summary.avgDuration)}ms，超过阈值 ${thresholds.avgDuration}ms`,
          data: {
            currentValue: summary.avgDuration,
            threshold: thresholds.avgDuration!,
          },
          detectedAt: Date.now(),
          suggestedAction: 'optimize',
        });
      }

      // 检测耗时趋势上升
      if (summary.recentTrend === 'rising') {
        anomalies.push({
          type: 'rising_duration',
          operation: summary.operation,
          message: `操作 ${summary.operation} 耗时趋势上升`,
          data: {
            currentValue: summary.avgDuration,
            threshold: 0,
            trend: 'rising',
          },
          detectedAt: Date.now(),
          suggestedAction: 'optimize',
        });
      }

      // 检测高超阈值率
      if (summary.exceededRate > thresholds.exceededRate!) {
        anomalies.push({
          type: 'high_exceeded_rate',
          operation: summary.operation,
          message: `操作 ${summary.operation} 超阈值率 ${Math.round(summary.exceededRate * 100)}%，超过阈值 ${thresholds.exceededRate! * 100}%`,
          data: {
            currentValue: summary.exceededRate,
            threshold: thresholds.exceededRate!,
          },
          detectedAt: Date.now(),
          suggestedAction: 'adjust_threshold',
        });
      }

      // 检测超阈值率上升
      if (summary.exceededRate > 0.1 && summary.recentTrend === 'rising') {
        anomalies.push({
          type: 'rising_exceeded_rate',
          operation: summary.operation,
          message: `操作 ${summary.operation} 超阈值率 ${Math.round(summary.exceededRate * 100)}% 且趋势上升`,
          data: {
            currentValue: summary.exceededRate,
            threshold: 0.1,
            trend: 'rising',
          },
          detectedAt: Date.now(),
          suggestedAction: 'optimize',
        });
      }

      // 检测高错误率
      if (summary.errorRate > thresholds.errorRate!) {
        anomalies.push({
          type: 'high_error_rate',
          operation: summary.operation,
          message: `操作 ${summary.operation} 错误率 ${Math.round(summary.errorRate * 100)}%，超过阈值 ${thresholds.errorRate! * 100}%`,
          data: {
            currentValue: summary.errorRate,
            threshold: thresholds.errorRate!,
          },
          detectedAt: Date.now(),
          suggestedAction: 'notify_user',
        });
      }
    }

    return anomalies;
  }

  /**
   * 对比上一周期
   *
   * 计算各指标的环比变化
   */
  compareWithPrevious(
    current: PerformanceSummary[],
    previous: PerformanceSummary[]
  ): PerformanceSummary[] {
    const previousMap = new Map(
      previous.map(s => [s.operation, s])
    );

    return current.map(summary => {
      const prev = previousMap.get(summary.operation);

      if (prev) {
        summary.changeFromLastPeriod = {
          avgDurationDelta: summary.avgDuration - prev.avgDuration,
          exceededRateDelta: summary.exceededRate - prev.exceededRate,
        };
      }

      return summary;
    });
  }

  /**
   * 按操作类型分组
   */
  private groupByOperation(traces: PerformanceTrace[]): Map<string, PerformanceTrace[]> {
    const grouped = new Map<string, PerformanceTrace[]>();

    for (const trace of traces) {
      const existing = grouped.get(trace.operation) || [];
      existing.push(trace);
      grouped.set(trace.operation, existing);
    }

    return grouped;
  }

  /**
   * 计算趋势
   *
   * 对比前半段和后半段的平均耗时
   */
  private calculateTrend(traces: PerformanceTrace[]): 'stable' | 'rising' | 'falling' {
    if (traces.length < 10) {
      return 'stable';
    }

    // 按时间排序
    const sorted = [...traces].sort((a, b) => a.timestamp - b.timestamp);

    // 分成前后两半
    const half = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, half);
    const secondHalf = sorted.slice(half);

    // 计算前半段和后半段的平均耗时
    const firstAvg = this.calcAverage(firstHalf.map(t => t.duration));
    const secondAvg = this.calcAverage(secondHalf.map(t => t.duration));

    // 计算变化率
    const delta = secondAvg - firstAvg;
    const changeRate = firstAvg > 0 ? delta / firstAvg : 0;

    // 判断趋势（变化 > 10% 才算显著）
    if (changeRate > 0.1) {
      return 'rising';
    } else if (changeRate < -0.1) {
      return 'falling';
    } else {
      return 'stable';
    }
  }

  /**
   * 计算平均值
   */
  private calcAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * 计算百分位数
   */
  private calcPercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;

    return sorted[Math.max(0, index)];
  }

  /**
   * 保存汇总结果
   */
  saveSummary(summaries: PerformanceSummary[]): void {
    const dir = path.dirname(this.config.summaryFile!);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(
      this.config.summaryFile!,
      JSON.stringify(summaries, null, 2),
      'utf-8'
    );
  }

  /**
   * 加载上次汇总结果
   */
  loadSummary(): PerformanceSummary[] | null {
    if (!fs.existsSync(this.config.summaryFile!)) {
      return null;
    }

    const content = fs.readFileSync(this.config.summaryFile!, 'utf-8');
    return JSON.parse(content) as PerformanceSummary[];
  }

  /**
   * 运行每小时汇总
   *
   * 自动执行，零 Token 成本
   */
  runHourlySummary(): PerformanceSummary[] {
    // 分析最近 1 小时
    const current = this.analyzeRecent(1);

    // 加载上次汇总，对比趋势
    const previous = this.loadSummary();
    if (previous) {
      this.compareWithPrevious(current, previous);
    }

    // 保存当前汇总
    this.saveSummary(current);

    return current;
  }

  /**
   * 运行每日异常检测
   *
   * 返回异常列表，用于触发优化
   */
  runDailyAnomalyCheck(): PerformanceAnomaly[] {
    // 分析最近 24 小时
    const summaries = this.analyzeRecent(24);

    // 检测异常
    const anomalies = this.detectAnomalies(summaries);

    return anomalies;
  }

  /**
   * 生成报告（文本格式）
   */
  generateReport(summaries: PerformanceSummary[], anomalies: PerformanceAnomaly[]): string {
    const lines: string[] = [];

    lines.push('# Performance Report');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    // 汇总部分
    lines.push('## Operation Summaries');
    lines.push('');

    for (const summary of summaries) {
      const trendEmoji = {
        rising: '📈',
        falling: '📉',
        stable: '➡️',
      }[summary.recentTrend];

      lines.push(`**${summary.operation}** ${trendEmoji}`);
      lines.push(`  - Calls: ${summary.totalCalls}`);
      lines.push(`  - Avg: ${Math.round(summary.avgDuration)}ms`);
      lines.push(`  - P95: ${Math.round(summary.p95Duration)}ms`);
      lines.push(`  - P99: ${Math.round(summary.p99Duration)}ms`);
      lines.push(`  - OK: ${Math.round(summary.okRate * 100)}%`);
      lines.push(`  - Exceeded: ${Math.round(summary.exceededRate * 100)}%`);
      lines.push(`  - Errors: ${Math.round(summary.errorRate * 100)}%`);
      lines.push('');
    }

    // 异常部分
    if (anomalies.length > 0) {
      lines.push('## Anomalies Detected');
      lines.push('');

      for (const anomaly of anomalies) {
        lines.push(`⚠️ **${anomaly.type}**: ${anomaly.operation}`);
        lines.push(`  - ${anomaly.message}`);
        lines.push(`  - Suggested: ${anomaly.suggestedAction}`);
        lines.push('');
      }
    } else {
      lines.push('## No Anomalies Detected ✅');
    }

    return lines.join('\n');
  }
}

/**
 * 创建分析器（使用全局收集器）
 */
export function createPerformanceAnalyzer(config?: Partial<PerformanceAnalyzerConfig>): PerformanceAnalyzer {
  const collector = new PerformanceCollector();
  return new PerformanceAnalyzer(collector, config);
}
