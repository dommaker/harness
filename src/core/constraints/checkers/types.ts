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
 * 单条约束检查实现
 */
export interface ConstraintCheck {
  /** 约束 ID（与 definitions 一致） */
  id: string;
  /** 检查主体：true = 满足 */
  evaluate(env: CheckEnv): Promise<boolean> | boolean;
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
 * 构造恒通过检查（promptInjection 驱动 / 仅提示类约束）
 */
export function alwaysPass(id: string): ConstraintCheck {
  return { id, evaluate: () => true };
}
