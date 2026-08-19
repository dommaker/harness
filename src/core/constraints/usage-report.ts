/**
 * 约束使用统计与退役候选诊断（ADR-0001 决策 2/3）
 *
 * `harness constraints report` 与 `harness constraints retire`（交互模式）共用的
 * 数据层：读取项目 traces.log，与生效集（getEffectiveConstraints）对齐，
 * 产出 check 层统计表与四类退役候选诊断。
 *
 * 只读：不创建目录、不写任何文件。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Constraint } from '../../types/constraint';
import type { ExecutionTrace } from '../../types/trace';
import { DEFAULT_TRACE_FILE } from '../../types/trace';
import { getEffectiveConstraints, lintEffectiveConfig } from '../effective-constraints';
import type { EffectiveConfigLint } from '../effective-constraints';

/**
 * flag 型 check 约束（证据来自 ConstraintContext flag，见 checkers/iron-flags.ts）。
 * 全部 skip 时标注"证据 flag 未接线"（区别于存在性探测的"约定未采用"）。
 */
export const FLAG_EVIDENCE_CONSTRAINT_IDS: ReadonlySet<string> = new Set([
  'no_completion_without_verification',
  'incremental_progress',
  'no_implementation_without_requirement',
]);

/**
 * 单条 check 约束的使用统计
 */
export interface ConstraintUsageStats {
  id: string;
  level: Constraint['level'];

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
 * report 数据模型
 */
export interface ConstraintsUsageReport {
  /** check 层统计表（生效集内每条 check 约束一行，零出现 total=0） */
  stats: ConstraintUsageStats[];
  /** 退役候选诊断（按 zero_trigger → unevaluable → high_noise → zero_intercept 排序） */
  candidates: RetireCandidate[];
  /** 当前生效的 prompt 条目 id（注入清单） */
  activePromptIds: string[];
  /** 配置健康诊断（unknownIds 等） */
  lint: EffectiveConfigLint;
  /** trace 文件是否存在 */
  traceFileExists: boolean;
}

/**
 * 读取项目 traces.log（只读，容错：坏行跳过）
 */
export function readProjectTraces(projectRoot: string): ExecutionTrace[] {
  const tracePath = path.join(projectRoot, DEFAULT_TRACE_FILE);
  if (!fs.existsSync(tracePath)) return [];

  const content = fs.readFileSync(tracePath, 'utf-8');
  const traces: ExecutionTrace[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      traces.push(JSON.parse(trimmed) as ExecutionTrace);
    } catch {
      // 坏行跳过（report 只读，不因单行损坏失败）
    }
  }
  return traces;
}

/**
 * 按约束聚合 trace 统计（Map: constraintId → 计数）
 */
export function collectUsageByConstraint(
  traces: ExecutionTrace[]
): Map<string, Omit<ConstraintUsageStats, 'id' | 'level' | 'evaluated' | 'failRate'>> {
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

function toStats(id: string, level: Constraint['level'], agg: { total: number; pass: number; fail: number; skip: number; firstAt?: number; lastAt?: number } | undefined): ConstraintUsageStats {
  const a = agg ?? { total: 0, pass: 0, fail: 0, skip: 0 };
  const evaluated = a.total - a.skip;
  return {
    id,
    level,
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

/**
 * 退役候选诊断（纯函数）
 *
 * 每条 check 约束最多归入一个类别，优先级：
 * zero_trigger → unevaluable → high_noise → zero_intercept
 */
export function diagnoseRetireCandidates(
  stats: ConstraintUsageStats[],
  thresholds: Partial<DiagnoseThresholds> = {}
): RetireCandidate[] {
  const t = { ...DEFAULT_DIAGNOSE_THRESHOLDS, ...thresholds };
  const candidates: RetireCandidate[] = [];

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
      candidates.push({
        id: s.id,
        kind: 'zero_intercept',
        stats: s,
        reason: `零拦截：${s.evaluated} 次评估从未 fail`,
      });
    }
  }

  return candidates;
}

/**
 * 构建 report 数据模型（只读）
 */
export function buildConstraintsUsageReport(
  projectRoot: string = process.cwd(),
  thresholds: Partial<DiagnoseThresholds> = {}
): ConstraintsUsageReport {
  const effective = getEffectiveConstraints(projectRoot);
  const checkConstraints = effective.filter(c => c.kind === 'check');
  const activePromptIds = effective.filter(c => c.kind === 'prompt').map(c => c.id);

  const tracePath = path.join(projectRoot, DEFAULT_TRACE_FILE);
  const traces = readProjectTraces(projectRoot);
  const usage = collectUsageByConstraint(traces);

  const stats = checkConstraints.map(c => toStats(c.id, c.level, usage.get(c.id)));
  const candidates = diagnoseRetireCandidates(stats, thresholds);
  const lint = lintEffectiveConfig(projectRoot);

  return {
    stats,
    candidates,
    activePromptIds,
    lint,
    traceFileExists: fs.existsSync(tracePath),
  };
}
