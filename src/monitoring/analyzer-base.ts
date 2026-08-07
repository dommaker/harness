/**
 * 分析器共享基础（工单 19-D）
 *
 * TraceAnalyzer 与 PerformanceAnalyzer 的镜像同构部分收敛于此：
 * 分组、时间范围、统计助手、summary 文件读写。
 * 两个分析器保持各自的公开类接口（P1 符号冻结），仅内部复用。
 */

import * as fs from 'fs';
import * as path from 'path';

export type Trend = 'stable' | 'rising' | 'falling';

/**
 * 按键分组（保持插入顺序）
 */
export function groupByKey<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = grouped.get(key) || [];
    existing.push(item);
    grouped.set(key, existing);
  }
  return grouped;
}

/**
 * 时间戳序列的起止范围
 */
export function timeRangeOf(timestamps: number[]): { start: number; end: number } {
  return {
    start: Math.min(...timestamps),
    end: Math.max(...timestamps),
  };
}

/**
 * 找出出现次数最多的元素
 */
export function findMostCommon(items: string[]): string | undefined {
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
 * 平均值
 */
export function calcAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * 百分位数（nearest-rank）
 */
export function calcPercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * 样本量不足时的趋势兜底阈值
 */
export const MIN_TREND_SAMPLES = 10;

/**
 * 按时间排序后对半分，供前后半段对比
 */
export function splitByTime<T extends { timestamp: number }>(items: T[]): [T[], T[]] {
  const sorted = [...items].sort((a, b) => a.timestamp - b.timestamp);
  const half = Math.floor(sorted.length / 2);
  return [sorted.slice(0, half), sorted.slice(half)];
}

/**
 * 保存 JSON summary 文件（目录不存在时创建）
 */
export function writeSummaryJson(summaryFile: string, data: unknown): void {
  const dir = path.dirname(summaryFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(summaryFile, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 读取 JSON summary 文件；不存在时返回 null
 */
export function readSummaryJson<T>(summaryFile: string): T | null {
  if (!fs.existsSync(summaryFile)) {
    return null;
  }
  const content = fs.readFileSync(summaryFile, 'utf-8');
  return JSON.parse(content) as T;
}
