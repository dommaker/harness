/**
 * 分析器共享基础（工单 19-D）
 *
 * TraceAnalyzer 与 PerformanceAnalyzer 的镜像同构部分收敛于此：
 * 分组、时间范围、统计助手。
 * 两个分析器保持各自的公开类接口（P1 符号冻结），仅内部复用。
 */

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
