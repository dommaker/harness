/**
 * 约束使用统计与退役候选诊断（ADR-0001 决策 2/3）
 *
 * `harness constraints report` 与 `harness constraints retire`（交互模式）共用的
 * 数据层：读取项目 traces.log，与生效集（getEffectiveConstraints）对齐，
 * 产出 check 约束统计表、四类退役候选诊断与零拦截观察名单（ADR-0032/0033 块 3 子项 4：
 * 零拦截先进观察名单挂一个季度，期满且样本足才转正式退役候选）。
 *
 * 只读：不创建目录、不写任何文件。观察名单状态以快照入参进来、以 `nextWatchlist`
 * 产物出去，持久化（`.harness/.state.json` 经 StateIO 接缝）是 cli 层调用方的职责。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Constraint } from '../../types/constraint';
import type { ExecutionTrace } from '../../types/trace';
import { DEFAULT_TRACE_FILE } from '../../types/trace';
import { readJsonl } from '../../utils/jsonl';
import { getEffectiveConstraints, lintEffectiveConfig } from '../effective-constraints';
import type { EffectiveConfigLint } from '../effective-constraints';

/**
 * flag 型 check 约束（证据来自 ConstraintContext flag，见 checkers/iron-flags.ts）。
 * 全部 skip 时标注"证据 flag 未接线"（区别于存在性探测的"约定未采用"）。
 */
export const FLAG_EVIDENCE_CONSTRAINT_IDS: ReadonlySet<string> = new Set([
  'no_completion_without_verification',
]);

/**
 * 单条 check 约束的使用统计
 */
export interface ConstraintUsageStats {
  id: string;
  severity: Constraint['severity'];

  /** trace 总行数（含 skip） */
  total: number;
  pass: number;
  fail: number;
  skip: number;

  /** 实际评估次数（total - skip；skip 未评估不计入，与 TraceAnalyzer 一致） */
  evaluated: number;

  /** 失败率（fail / evaluated；evaluated=0 时为 0） */
  failRate: number;

  /** 首次/最近触发时间（Unix ms）；无 trace 时为 undefined */
  firstAt?: number;
  lastAt?: number;
}

/**
 * 退役候选类别
 */
export type RetireCandidateKind =
  | 'zero_trigger'   // 零触发：生效集中从未出现在 trace
  | 'unevaluable'    // 不可评估：全部 skip
  | 'high_noise'     // 高噪：fail 率异常高，疑似误报源
  | 'zero_intercept'; // 零拦截：样本充足但从未 fail

export interface RetireCandidate {
  id: string;
  kind: RetireCandidateKind;
  stats: ConstraintUsageStats;
  /** 人类可读的诊断说明（带证据数字） */
  reason: string;
}

/** 候选种类的呈现名（constraints report / retire 共用） */
export const CANDIDATE_KIND_LABEL: Record<RetireCandidateKind, string> = {
  zero_trigger: '零触发',
  unevaluable: '不可评估',
  high_noise: '高噪',
  zero_intercept: '零拦截',
};

/**
 * 候选诊断阈值（CLI 可覆盖）
 */
export interface DiagnoseThresholds {
  /** 零拦截候选的最小评估样本数，默认 50 */
  zeroInterceptMinEvaluated: number;
  /** 高噪候选的 fail 率阈值（严格大于），默认 0.8 */
  highNoiseFailRate: number;
  /** 高噪候选的最小评估样本数，默认 20 */
  highNoiseMinEvaluated: number;
}

export const DEFAULT_DIAGNOSE_THRESHOLDS: DiagnoseThresholds = {
  zeroInterceptMinEvaluated: 50,
  highNoiseFailRate: 0.8,
  highNoiseMinEvaluated: 20,
};

/**
 * 观察名单状态条目（ADR-0032 口径，块 3 子项 4）
 *
 * 持久化在 `.harness/.state.json` 的 `constraintWatchlist` 段（StateIO 接缝，
 * cli 层读-改-写）；本层只认快照，不碰 fs。
 */
export interface WatchlistStateEntry {
  /** 列入观察名单时刻（ISO 串，与 HarnessState 其余时间字段同形） */
  listedAt: string;
}

/** 观察名单状态（constraintId → 条目） */
export type ConstraintWatchlistState = Record<string, WatchlistStateEntry>;

/** 观察期时长（天）：满一个季度且样本仍达标，零拦截才转正式退役候选 */
export const WATCHLIST_PERIOD_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * report 里单独分组展示的观察名单条目
 *
 * 列入即进 report（告知面），但不进退役候选；观察期内再次出现 fail / 样本
 * 跌破阈值时条目自然消失（状态段里的列入记录保留，时钟不回拨）。
 */
export interface WatchlistEntry {
  id: string;
  stats: ConstraintUsageStats;
  /** 列入时刻（ISO 串） */
  listedAt: string;
  /** 剩余观察天数（观察期未满恒 > 0） */
  remainingDays: number;
  /** 人类可读的诊断说明（带证据数字） */
  reason: string;
}

/**
 * 候选诊断的观察名单上下文（不传 = 空名单 + 真实时钟）
 */
export interface DiagnoseWatchOptions {
  /** 观察名单状态快照（来自 `.harness/.state.json`，缺省空） */
  watchlist?: ConstraintWatchlistState;
  /** 当前时刻（Unix ms），测试注入用——别在测试里等 90 天 */
  now?: number;
}

/**
 * report 数据模型
 */
export interface ConstraintsUsageReport {
  /** check 约束统计表（生效集内每条约束一行，零出现 total=0） */
  stats: ConstraintUsageStats[];
  /** 退役候选诊断（按 zero_trigger → unevaluable → high_noise → zero_intercept 排序） */
  candidates: RetireCandidate[];
  /** 零拦截观察名单（进 report 但不进退役候选；期满且样本足才转候选） */
  watchlist: WatchlistEntry[];
  /**
   * 观察名单读-改-写产物：入参快照 + 本次新列入（只增不删）。
   * 与入参快照键数不同（有新增）时，调用方应经 StateIO 写回 `.harness/.state.json`。
   */
  nextWatchlist: ConstraintWatchlistState;
  /** 配置健康诊断（unknownIds 等） */
  lint: EffectiveConfigLint;
  /** trace 文件是否存在 */
  traceFileExists: boolean;
  /**
   * trace 文件被跳过的坏行数（harness#100，与 `traceFileExists` 同一降级维度）
   *
   * 恒有值，0 = 无损坏。文件级口径：坏行没有 timestamp，归不进任何统计窗口。
   */
  skippedLines: number;
}

/**
 * 读取项目 traces.log 并带出坏行计数（只读，harness#100 报告入口）
 *
 * 坏行策略：skip（原语义不变——report 只读，不因单行损坏失败）；
 * 计数去向：透传——`skippedLines` 随本方法返回，进 `ConstraintsUsageReport.skippedLines`，
 * 消费面为 `constraints report` 的文本行 / `--json-output` 字段 / `--export` 摘要。
 */
export function readProjectTracesReport(projectRoot: string): { traces: ExecutionTrace[]; skippedLines: number } {
  const { records, skippedLines } = readJsonl<ExecutionTrace>(
    path.join(projectRoot, DEFAULT_TRACE_FILE),
    'skip'
  );
  return { traces: records, skippedLines };
}

/**
 * 读取项目 traces.log（只读）
 *
 * 兼容签名：只返回记录数组、丢坏行计数，需要计数的消费方走 `readProjectTracesReport()`。
 */
export function readProjectTraces(projectRoot: string): ExecutionTrace[] {
  return readProjectTracesReport(projectRoot).traces;
}

/**
 * 按约束聚合 trace 统计（Map: constraintId → 计数）
 */
export function collectUsageByConstraint(
  traces: ExecutionTrace[]
): Map<string, Omit<ConstraintUsageStats, 'id' | 'severity' | 'evaluated' | 'failRate'>> {
  const map = new Map<string, { total: number; pass: number; fail: number; skip: number; firstAt?: number; lastAt?: number }>();
  for (const t of traces) {
    let agg = map.get(t.constraintId);
    if (!agg) {
      agg = { total: 0, pass: 0, fail: 0, skip: 0 };
      map.set(t.constraintId, agg);
    }
    agg.total++;
    if (t.result === 'pass') agg.pass++;
    else if (t.result === 'fail') agg.fail++;
    else if (t.result === 'skip') agg.skip++;
    if (agg.firstAt === undefined || t.timestamp < agg.firstAt) agg.firstAt = t.timestamp;
    if (agg.lastAt === undefined || t.timestamp > agg.lastAt) agg.lastAt = t.timestamp;
  }
  return map;
}

function toStats(id: string, severity: Constraint['severity'], agg: { total: number; pass: number; fail: number; skip: number; firstAt?: number; lastAt?: number } | undefined): ConstraintUsageStats {
  const a = agg ?? { total: 0, pass: 0, fail: 0, skip: 0 };
  const evaluated = a.total - a.skip;
  return {
    id,
    severity,
    total: a.total,
    pass: a.pass,
    fail: a.fail,
    skip: a.skip,
    evaluated,
    failRate: evaluated > 0 ? a.fail / evaluated : 0,
    firstAt: a.firstAt,
    lastAt: a.lastAt,
  };
}

/** 诊断完整产物（candidates + watchlist + 待写回的状态） */
interface DiagnoseOutcome {
  candidates: RetireCandidate[];
  watchlist: WatchlistEntry[];
  nextWatchlist: ConstraintWatchlistState;
}

/**
 * 退役候选诊断（纯函数）
 *
 * 每条约束最多归入一个类别，优先级：
 * zero_trigger → unevaluable → high_noise → zero_intercept
 *
 * zero_intercept 走观察名单中间态（ADR-0032）：命中且样本够 → 不在名单则列入
 * （listedAt = now），进 watchlist 不进 candidates；已在名单且满 WATCHLIST_PERIOD_DAYS
 * 且当前样本仍达标 → 转正式 zero_intercept 退役候选。其他三类不进观察名单。
 */
function diagnose(
  stats: ConstraintUsageStats[],
  t: DiagnoseThresholds,
  watch: DiagnoseWatchOptions
): DiagnoseOutcome {
  const now = watch.now ?? Date.now();
  const watchlistState = watch.watchlist ?? {};
  const nextWatchlist: ConstraintWatchlistState = { ...watchlistState };
  const candidates: RetireCandidate[] = [];
  const watchlistEntries: WatchlistEntry[] = [];

  for (const s of stats) {
    if (s.total === 0) {
      candidates.push({
        id: s.id,
        kind: 'zero_trigger',
        stats: s,
        reason: '零触发：生效集内从未出现在 trace',
      });
      continue;
    }

    if (s.skip === s.total) {
      const wiring = FLAG_EVIDENCE_CONSTRAINT_IDS.has(s.id)
        ? '证据 flag 未接线'
        : '约定未采用（存在性探测未命中）';
      candidates.push({
        id: s.id,
        kind: 'unevaluable',
        stats: s,
        reason: `不可评估：全部 ${s.total} 次均为 skip（${wiring}）`,
      });
      continue;
    }

    if (s.failRate > t.highNoiseFailRate && s.evaluated >= t.highNoiseMinEvaluated) {
      candidates.push({
        id: s.id,
        kind: 'high_noise',
        stats: s,
        reason: `高噪：fail 率 ${Math.round(s.failRate * 100)}%（${s.fail}/${s.evaluated}），疑似误报源`,
      });
      continue;
    }

    if (s.fail === 0 && s.evaluated >= t.zeroInterceptMinEvaluated) {
      const listed = watchlistState[s.id];
      const listedAtMs = listed ? Date.parse(listed.listedAt) : NaN;
      // 列入时间损坏按未列入处理：重新列入、时钟重启（状态文件是人可手改的，不静默信脏值）
      const isListed = listed !== undefined && Number.isFinite(listedAtMs);

      if (isListed && now - listedAtMs >= WATCHLIST_PERIOD_DAYS * DAY_MS) {
        candidates.push({
          id: s.id,
          kind: 'zero_intercept',
          stats: s,
          reason: `零拦截：观察期满（${listed.listedAt.slice(0, 10)} 列入，已满 ${WATCHLIST_PERIOD_DAYS} 天），${s.evaluated} 次评估从未 fail`,
        });
        continue;
      }

      const listedAt = isListed ? listed.listedAt : new Date(now).toISOString();
      if (!isListed) {
        nextWatchlist[s.id] = { listedAt };
      }
      watchlistEntries.push({
        id: s.id,
        stats: s,
        listedAt,
        remainingDays: isListed
          ? Math.max(0, Math.ceil((listedAtMs + WATCHLIST_PERIOD_DAYS * DAY_MS - now) / DAY_MS))
          : WATCHLIST_PERIOD_DAYS,
        reason: `零拦截：${s.evaluated} 次评估从未 fail`,
      });
    }
  }

  return { candidates, watchlist: watchlistEntries, nextWatchlist };
}

/**
 * 退役候选诊断（纯函数）——观察名单兼容包装
 *
 * 每条约束最多归入一个类别，优先级：
 * zero_trigger → unevaluable → high_noise → zero_intercept
 *
 * 只返回退役候选；观察名单分组与待写回状态走 `buildConstraintsUsageReport`
 * 的 `watchlist` / `nextWatchlist` 字段。zero_intercept 仅在观察期满且样本足时
 * 才出现在本返回值里（ADR-0032），未期满的命中不再直接列候选。
 */
export function diagnoseRetireCandidates(
  stats: ConstraintUsageStats[],
  thresholds: Partial<DiagnoseThresholds> = {},
  watch: DiagnoseWatchOptions = {}
): RetireCandidate[] {
  const t = { ...DEFAULT_DIAGNOSE_THRESHOLDS, ...thresholds };
  return diagnose(stats, t, watch).candidates;
}

/**
 * 构建 report 数据模型（只读；观察名单状态以快照入、以 nextWatchlist 出，不写盘）
 */
export function buildConstraintsUsageReport(
  projectRoot: string = process.cwd(),
  thresholds: Partial<DiagnoseThresholds> = {},
  watch: DiagnoseWatchOptions = {}
): ConstraintsUsageReport {
  const effective = getEffectiveConstraints(projectRoot);

  const tracePath = path.join(projectRoot, DEFAULT_TRACE_FILE);
  const { traces, skippedLines } = readProjectTracesReport(projectRoot);
  const usage = collectUsageByConstraint(traces);

  const stats = effective.map(c => toStats(c.id, c.severity, usage.get(c.id)));
  const t = { ...DEFAULT_DIAGNOSE_THRESHOLDS, ...thresholds };
  const outcome = diagnose(stats, t, watch);
  const lint = lintEffectiveConfig(projectRoot);

  return {
    stats,
    candidates: outcome.candidates,
    watchlist: outcome.watchlist,
    nextWatchlist: outcome.nextWatchlist,
    lint,
    traceFileExists: fs.existsSync(tracePath),
    skippedLines,
  };
}
