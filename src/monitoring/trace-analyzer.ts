/**
 * Trace 分析器
 *
 * 纯计算，零 Token 成本
 *
 * 功能：
 * - 统计汇总（每小时自动执行）
 * - 异常检测（每日检查）
 * - 趋势分析（对比上一周期）
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ExecutionTrace,
  TraceSummary,
  TraceAnomaly,
  TraceFilter,
  TraceAnalyzerConfig,
} from '../types/trace';
import { TraceCollector } from './traces';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: TraceAnalyzerConfig = {
  summaryFile: '.harness/logs/traces-summary.json',
  periodMs: 3600 * 1000, // 1 小时
  thresholds: {
    bypassRate: 0.3,      // 绕过率 > 30% 视为异常
    failRate: 0.5,        // 失败率 > 50% 视为异常
    exceptionRate: 0.4,   // 例外率 > 40% 视为滥用
  },
};

/**
 * Trace 分析器
 *
 * 使用方式：
 * ```typescript
 * const analyzer = new TraceAnalyzer(collector);
 * const summaries = analyzer.summarize(traces);
 * const anomalies = analyzer.detectAnomalies(summaries);
 * ```
 */
export class TraceAnalyzer {
  private config: TraceAnalyzerConfig;
  private collector: TraceCollector;

  constructor(collector: TraceCollector, config?: Partial<TraceAnalyzerConfig>) {
    this.collector = collector;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成统计汇总
 *
   * 纯计算，零 Token 成本
   */
  summarize(traces: ExecutionTrace[]): TraceSummary[] {
    // 按约束 ID 分组
    const grouped = this.groupByConstraint(traces);

    const summaries: TraceSummary[] = [];

    for (const [constraintId, group] of grouped) {
      // 提取层级（从第一条 trace）
      const level = group[0].level;

      // 计算时间范围
      const timestamps = group.map(t => t.timestamp);
      const timeRange = {
        start: Math.min(...timestamps),
        end: Math.max(...timestamps),
      };

      // 单次遍历计算核心统计
      const totalChecks = group.length;
      let passCount = 0, failCount = 0, bypassCount = 0, ignoreCount = 0;
      for (const t of group) {
        if (t.result === 'pass') passCount++;
        else if (t.result === 'fail') failCount++;
        else if (t.result === 'bypassed') bypassCount++;
        if (t.userAction === 'ignore') ignoreCount++;
      }

      // 计算比率
      const passRate = totalChecks > 0 ? passCount / totalChecks : 0;
      const failRate = totalChecks > 0 ? failCount / totalChecks : 0;
      const bypassRate = totalChecks > 0 ? bypassCount / totalChecks : 0;

      // 计算例外统计
      const exceptionTraces = group.filter(t => t.exceptionApplied);
      const exceptionCount = exceptionTraces.length;
      const exceptionTypes = exceptionTraces.map(t => t.exceptionApplied!);
      const mostCommonException = this.findMostCommon(exceptionTypes);

      // 计算趋势
      const recentTrend = this.calculateTrend(group);

      summaries.push({
        constraintId,
        level,
        timeRange,
        totalChecks,
        passCount,
        failCount,
        bypassCount,
        ignoreCount,
        passRate,
        failRate,
        bypassRate,
        recentTrend,
        exceptionCount,
        mostCommonException,
      });
    }

    return summaries;
  }

  /**
   * 分析最近 N 小时的 traces
   */
  analyzeRecent(hours: number): TraceSummary[] {
    const traces = this.collector.readRecent(hours);
    return this.summarize(traces);
  }

  /**
   * 分析特定约束
   */
  analyzeConstraint(constraintId: string): TraceSummary[] {
    const traces = this.collector.readByConstraint(constraintId);
    return this.summarize(traces);
  }

  /**
   * 检测异常
   *
   * 基于阈值检测异常模式
   */
  detectAnomalies(summaries: TraceSummary[]): TraceAnomaly[] {
    const anomalies: TraceAnomaly[] = [];
    const thresholds = this.config.thresholds!;

    for (const summary of summaries) {
      // 检测高绕过率
      if (summary.bypassRate > thresholds.bypassRate!) {
        anomalies.push({
          type: 'high_bypass_rate',
          constraintId: summary.constraintId,
          level: summary.level,
          message: `约束 ${summary.constraintId} 绕过率 ${Math.round(summary.bypassRate * 100)}%，超过阈值 ${thresholds.bypassRate! * 100}%`,
          data: {
            currentRate: summary.bypassRate,
            threshold: thresholds.bypassRate!,
            trend: summary.recentTrend,
          },
          detectedAt: Date.now(),
          suggestedAction: 'diagnose',
        });
      }

      // 检测失败率上升
      if (summary.failRate > thresholds.failRate! && summary.recentTrend === 'rising') {
        anomalies.push({
          type: 'rising_fail_rate',
          constraintId: summary.constraintId,
          level: summary.level,
          message: `约束 ${summary.constraintId} 失败率 ${Math.round(summary.failRate * 100)}% 且趋势上升`,
          data: {
            currentRate: summary.failRate,
            threshold: thresholds.failRate!,
            trend: 'rising',
          },
          detectedAt: Date.now(),
          suggestedAction: 'diagnose',
        });
      }

      // 检测绕过率上升
      if (summary.bypassRate > 0.1 && summary.recentTrend === 'rising') {
        anomalies.push({
          type: 'rising_bypass_rate',
          constraintId: summary.constraintId,
          level: summary.level,
          message: `约束 ${summary.constraintId} 绕过率 ${Math.round(summary.bypassRate * 100)}% 且趋势上升`,
          data: {
            currentRate: summary.bypassRate,
            threshold: 0.1,
            trend: 'rising',
          },
          detectedAt: Date.now(),
          suggestedAction: 'diagnose',
        });
      }

      // 检测低通过率
      if (summary.passRate < 0.3) {
        anomalies.push({
          type: 'low_pass_rate',
          constraintId: summary.constraintId,
          level: summary.level,
          message: `约束 ${summary.constraintId} 通过率 ${Math.round(summary.passRate * 100)}%，低于 30%`,
          data: {
            currentRate: summary.passRate,
            threshold: 0.3,
            trend: summary.recentTrend,
          },
          detectedAt: Date.now(),
          suggestedAction: 'adjust_threshold',
        });
      }

      // 检测例外滥用
      const exceptionRate = summary.totalChecks > 0
        ? summary.exceptionCount / summary.totalChecks
        : 0;

      if (exceptionRate > thresholds.exceptionRate!) {
        anomalies.push({
          type: 'exception_overuse',
          constraintId: summary.constraintId,
          level: summary.level,
          message: `约束 ${summary.constraintId} 例外使用率 ${Math.round(exceptionRate * 100)}%，可能过度依赖例外`,
          data: {
            currentRate: exceptionRate,
            threshold: thresholds.exceptionRate!,
          },
          detectedAt: Date.now(),
          suggestedAction: 'add_exception',
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
    current: TraceSummary[],
    previous: TraceSummary[]
  ): TraceSummary[] {
    const previousMap = new Map(
      previous.map(s => [s.constraintId, s])
    );

    return current.map(summary => {
      const prev = previousMap.get(summary.constraintId);

      if (prev) {
        summary.changeFromLastPeriod = {
          passRateDelta: summary.passRate - prev.passRate,
          failRateDelta: summary.failRate - prev.failRate,
          bypassRateDelta: summary.bypassRate - prev.bypassRate,
        };
      }

      return summary;
    });
  }

  /**
   * 按约束 ID 分组
   */
  private groupByConstraint(traces: ExecutionTrace[]): Map<string, ExecutionTrace[]> {
    const grouped = new Map<string, ExecutionTrace[]>();

    for (const trace of traces) {
      const existing = grouped.get(trace.constraintId) || [];
      existing.push(trace);
      grouped.set(trace.constraintId, existing);
    }

    return grouped;
  }

  /**
   * 计算趋势
 *
   * 对比前半段和后半段的通过率
   */
  private calculateTrend(traces: ExecutionTrace[]): 'stable' | 'rising' | 'falling' {
    if (traces.length < 10) {
      return 'stable';
    }

    // 按时间排序
    const sorted = [...traces].sort((a, b) => a.timestamp - b.timestamp);

    // 分成前后两半
    const half = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, half);
    const secondHalf = sorted.slice(half);

    // 计算前半段和后半段的通过率
    const firstPassRate = this.calcPassRate(firstHalf);
    const secondPassRate = this.calcPassRate(secondHalf);

    // 计算变化
    const delta = secondPassRate - firstPassRate;

    // 判断趋势（变化 > 5% 才算显著）
    if (delta > 0.05) {
      return 'rising';
    } else if (delta < -0.05) {
      return 'falling';
    } else {
      return 'stable';
    }
  }

  /**
   * 计算通过率
   */
  private calcPassRate(traces: ExecutionTrace[]): number {
    if (traces.length === 0) return 0;
    const passCount = traces.filter(t => t.result === 'pass').length;
    return passCount / traces.length;
  }

  /**
   * 找出最常见元素
   */
  private findMostCommon(items: string[]): string | undefined {
    if (items.length === 0) return undefined;

    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }

    let maxCount = 0;
    let mostCommon: string | undefined;

    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = item;
      }
    }

    return mostCommon;
  }

  /**
   * 保存汇总结果
   */
  saveSummary(summaries: TraceSummary[]): void {
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
  loadSummary(): TraceSummary[] | null {
    if (!fs.existsSync(this.config.summaryFile!)) {
      return null;
    }

    const content = fs.readFileSync(this.config.summaryFile!, 'utf-8');
    return JSON.parse(content) as TraceSummary[];
  }

  /**
   * 运行每小时汇总
 *
   * 自动执行，零 Token 成本
   */
  runHourlySummary(): TraceSummary[] {
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
   * 返回异常列表，用于触发 Agent 诊断
   */
  runDailyAnomalyCheck(): TraceAnomaly[] {
    // 分析最近 24 小时
    const summaries = this.analyzeRecent(24);

    // 检测异常
    const anomalies = this.detectAnomalies(summaries);

    return anomalies;
  }

  /**
   * 生成报告（文本格式）
   */
  generateReport(summaries: TraceSummary[], anomalies: TraceAnomaly[]): string {
    const lines: string[] = [];

    lines.push('# Harness Trace Report');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    // 汇总部分
    lines.push('## Constraint Summaries');
    lines.push('');

    for (const summary of summaries) {
      const levelEmoji = {
        iron_law: '🔴',
        guideline: '🟡',
        tip: '🔵',
      }[summary.level];

      lines.push(`${levelEmoji} **${summary.constraintId}**`);
      lines.push(`  - Checks: ${summary.totalChecks}`);
      lines.push(`  - Pass: ${Math.round(summary.passRate * 100)}%`);
      lines.push(`  - Fail: ${Math.round(summary.failRate * 100)}%`);
      lines.push(`  - Bypass: ${Math.round(summary.bypassRate * 100)}%`);
      lines.push(`  - Trend: ${summary.recentTrend}`);
      lines.push('');
    }

    // 异常部分
    if (anomalies.length > 0) {
      lines.push('## Anomalies Detected');
      lines.push('');

      for (const anomaly of anomalies) {
        lines.push(`⚠️ **${anomaly.type}**: ${anomaly.constraintId}`);
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
export function createAnalyzer(config?: Partial<TraceAnalyzerConfig>): TraceAnalyzer {
  const collector = new TraceCollector();
  return new TraceAnalyzer(collector, config);
}
