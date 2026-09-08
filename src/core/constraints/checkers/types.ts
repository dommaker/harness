/**
 * 约束检查器接缝类型（工单 21）
 *
 * checker.ts 的 per-constraint 实现拆分到 checkers/ 目录，
 * 通过 ConstraintCheck 接口 + CheckEnv 环境与编排层解耦。
 */

import type { ConstraintContext } from '../../../types/constraint';

/**
 * 检查环境：单次 run 内共享的上下文与 memoized I/O
 *
 * - stagedDiff/stagedDiffNames：run 内 git 命令至多一次（工单 18）
 * - srcScan：run 内同根源码扫描至多一次（CheckCache）
 */
export interface CheckEnv {
  /** 约束上下文（operation/changedFiles/各类证据标志） */
  context: ConstraintContext;
  /** 项目根路径（context.projectPath || process.cwd()） */
  projectPath: string;
  /** staged 全量 diff（run 内 memoized） */
  stagedDiff(): Promise<string>;
  /** staged 变更文件名列表（run 内 memoized） */
  stagedDiffNames(): Promise<string>;
  /** 源码根相对路径文件列表（run 内 cached） */
  srcScan(root: string): string[];
}

/**
 * 证据提供者组：git diff / 源码扫描的 memoized I/O
 *
 * 由调用方绑定后传入 buildCheckEnv（#87：git 两项绑 GitEvidence adapter 实例，
 * 一次 run 一份，命令级 memo 在 adapter 层）；工厂本身不做 memoization。
 */
export interface EvidenceProviders {
  /** staged 全量 diff */
  stagedDiff(): Promise<string>;
  /** staged 变更文件名列表 */
  stagedDiffNames(): Promise<string>;
  /** 源码根相对路径文件列表 */
  srcScan(root: string): string[];
}

/**
 * 构造 CheckEnv：生产侧唯一构造点
 *
 * - providers 传入 = 证据接线，checker 正常评估
 * - 'none' = 显式不接证据：证据函数返回空；evidence flag 未接线的
 *   checker 按契约返回 'skip'（见 contextEvidenceFlag），直接读空
 *   证据的 checker 在自然输入下判定
 *
 * studio 侧若需 git 证据（#129），传真实 providers 即可。
 */
export function buildCheckEnv(
  context: ConstraintContext,
  evidence: EvidenceProviders | 'none'
): CheckEnv {
  const projectPath = context.projectPath || process.cwd();
  if (evidence === 'none') {
    return {
      context,
      projectPath,
      stagedDiff: async () => '',
      stagedDiffNames: async () => '',
      srcScan: () => [],
    };
  }
  return { context, projectPath, ...evidence };
}

/**
 * 检查结果三态（ADR-0001 存在性探测 / flag 未接线）：
 * - true = 满足（pass）
 * - false = 违反（fail）
 * - 'skip' = 未评估（项目未采用对应约定，或证据 flag 未接线），不计 pass/fail
 * - CheckDetail = 判定 + 证据行（harness#119）
 */
export type CheckOutcome = boolean | 'skip' | CheckDetail;

/**
 * 带证据的检查结果（harness#119）
 *
 * 动机：只回布尔时，fail 的具体原因（哪个文件没登记）在 CLI 与 trace 两头都落脚不了，
 * 一条恒红的约束无法被诊断。证据行由 checker 自行措辞（自描述、可直接给人看），
 * 编排层只负责透传与打印，不参与解释内容。
 *
 * `pass: true` + 非空 evidence = 「满足但有提示」：不进 pass/fail 统计口径，
 * 仅作为可观测输出（如仓库级文档漂移——与本次变更无因果，不该判违规）。
 */
export interface CheckDetail {
  /** false = 违反；true = 满足 */
  pass: boolean;
  /** 证据行（每条自描述，如「变更文件未登记: src/foo.ts」） */
  evidence?: string[];
}

/** 归一后的检查结果：编排层 / gate 唯一消费形状 */
export interface NormalizedOutcome {
  satisfied: boolean;
  skipped: boolean;
  evidence: string[];
}

/** 证据条数上限：trace 是 JSONL，缺口上百项时不能整仓落盘 */
export const MAX_EVIDENCE_ITEMS = 10;

/**
 * 组装证据行：一行说明 + 逐条依据（超限截断）
 *
 * 每行自描述且不带缩进——缩进由消费端（CLI / gate 理由 / 铁律异常文案）决定，trace 原样存。
 * 修复入口不写在这里：那是各约束自己的事，写进各自的 summary 行（docs_freshness 的
 * 幽灵条目与 sync-docs 无关，共用一个指针会误导）。
 */
export function formatEvidence(summary: string, items: string[]): string[] {
  const shown = items.slice(0, MAX_EVIDENCE_ITEMS);
  const hidden = items.length - shown.length;
  return [...(summary ? [summary] : []), ...shown, ...(hidden > 0 ? [`…另 ${hidden} 项`] : [])];
}

/**
 * 归一 CheckOutcome（boolean | 'skip' | CheckDetail）为统一形状
 *
 * skip 恒不携带证据：未评估的约束不得留下证据行（否则统计侧会把「没查」读成「查出问题」）。
 */
export function normalizeCheckOutcome(outcome: CheckOutcome): NormalizedOutcome {
  if (outcome === 'skip') return { satisfied: true, skipped: true, evidence: [] };
  if (typeof outcome === 'boolean') return { satisfied: outcome, skipped: false, evidence: [] };
  return {
    satisfied: outcome.pass,
    skipped: false,
    evidence: outcome.evidence ?? [],
  };
}

/**
 * 单条约束检查实现
 */
export interface ConstraintCheck {
  /** 约束 ID（与 definitions 一致） */
  id: string;
  /** 检查主体：true = 满足；false = 违反；'skip' = 未评估；CheckDetail = 判定 + 证据行 */
  evaluate(env: CheckEnv): Promise<CheckOutcome> | CheckOutcome;
}

/**
 * 构造纯上下文标志检查（无 I/O 的轻量约束）
 */
export function contextFlag(
  id: string,
  predicate: (context: ConstraintContext) => boolean
): ConstraintCheck {
  return { id, evaluate: (env) => predicate(env.context) };
}

/**
 * 构造证据标志检查（ADR-0001：flag 未接线 = skip 而非 fail）
 *
 * - flag === undefined：调用方未接线该证据 → 'skip'（不评估，不误报违规）
 * - flag === false：显式无证据 → fail
 * - flag === true：有证据 → pass
 */
export function contextEvidenceFlag(
  id: string,
  pick: (context: ConstraintContext) => boolean | undefined
): ConstraintCheck {
  return {
    id,
    evaluate: (env) => {
      const value = pick(env.context);
      if (value === undefined) return 'skip';
      return value;
    },
  };
}
