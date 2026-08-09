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
 * 检查结果三态（ADR-0001 存在性探测 / flag 未接线）：
 * - true = 满足（pass）
 * - false = 违反（fail）
 * - 'skip' = 未评估（项目未采用对应约定，或证据 flag 未接线），不计 pass/fail
 */
export type CheckOutcome = boolean | 'skip';

/**
 * 单条约束检查实现
 */
export interface ConstraintCheck {
  /** 约束 ID（与 definitions 一致） */
  id: string;
  /** 检查主体：true = 满足；false = 违反；'skip' = 未评估 */
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
