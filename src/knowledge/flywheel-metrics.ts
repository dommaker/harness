/**
 * 知识飞轮指标（harness#81）
 *
 * 纯判定 module：吃 active 条目数组（+ 可选当日消费事件数），一次产出 canonical 飞轮指标。
 * 零 IO——人口筛选（哪些条目算 active）与 `.consumption-stats.json` 读取都留在调用方。
 *
 * 此前同一组分子计算在 audit.ts D6、knowledge stats、knowledge health 三处独立实现，
 * 后两处直接数 `referencedBy.length`，把 search / prompt-inject / test-agent 等自动化
 * 触碰算成真实消费——同一知识库报出两套飞轮健康度（实测 refCoverage 26% vs 28%、
 * avgRefs 0.4 vs 0.6）。飞轮指标是退役/降级判定的输入，口径必须唯一：
 * **分子一律为过滤 synthetic 后的 genuine refs**（ADR-0013）。
 *
 * 单位约定：本 module 只出比例（0..1），百分比取整/一位小数等是展示层的事。
 */

import type { KnowledgeEntry } from './types';

/**
 * 自动化写入方形成的引用键：`<contributor>:<YYYY-MM-DD>`（contributor 见 recordReference）。
 * 这些是检索/运维动作的按天记账，不代表条目被真实消费，不计入飞轮分子。
 * `unknown:`（query() 注入路径）不在过滤面内——注入即消费，维持既有语义。
 */
const SYNTHETIC_REF_PATTERN = /^(search|test-agent|prompt-inject|monitor|analyst|auditor|triage|executor|session|trend|incident):\d{4}-\d{2}-\d{2}/;

/** 剔除 synthetic refs，返回真实消费引用（唯一口径） */
export function genuineRefs(refs: string[]): string[] {
  return refs.filter(r => !SYNTHETIC_REF_PATTERN.test(r));
}

export interface FlywheelEnv {
  /** 参与统计的条目人口（调用方筛选，本 module 不再过滤 archived/deprecated） */
  entries: KnowledgeEntry[];
  /** 当日消费事件数（`.consumption-stats.json` 的 dailyEvents，MonitorAgent 汇总写入）；未提供视为 0 */
  dailyConsumptionEvents?: number;
}

export interface FlywheelMetrics {
  /** 人口大小 */
  activeEntries: number;
  /** 分子：有 genuine 引用（含 1 条即算）的条目数 */
  entriesWithRefs: number;
  /** entriesWithRefs / activeEntries，0..1；空人口为 0 */
  refCoverage: number;
  /** genuine 引用总数 / activeEntries，未取整比例 */
  avgRefs: number;
  /** 透传输入，供报告层复用 */
  dailyConsumptionEvents: number;
  /** dailyConsumptionEvents / activeEntries，capped at 1；无消费事件为 0 */
  consumptionHitRate: number;
}

export function evaluateFlywheel(env: FlywheelEnv): FlywheelMetrics {
  const entries = env.entries;
  const dailyConsumptionEvents = env.dailyConsumptionEvents ?? 0;
  const activeEntries = entries.length;

  const refCounts = entries.map(e => genuineRefs(e.referencedBy).length);
  const entriesWithRefs = refCounts.filter(n => n > 0).length;
  const totalRefs = refCounts.reduce((sum, n) => sum + n, 0);

  return {
    activeEntries,
    entriesWithRefs,
    refCoverage: activeEntries > 0 ? entriesWithRefs / activeEntries : 0,
    avgRefs: activeEntries > 0 ? totalRefs / activeEntries : 0,
    dailyConsumptionEvents,
    consumptionHitRate: activeEntries > 0
      ? Math.min(dailyConsumptionEvents / activeEntries, 1)
      : 0,
  };
}
