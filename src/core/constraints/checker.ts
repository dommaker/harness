/**
 * 约束检查引擎
 *
 * kind 二元模型（ADR-0001）：
 * - check · Iron Laws：检查失败立即抛出异常
 * - check · Guidelines：检查失败记录警告
 * - prompt：不执行 checker，仅参与注入
 */

import {
  Constraint,
  ConstraintContext,
  ConstraintResult,
  ConstraintCheckResult,
  ConstraintLevel,
  ConstraintViolationError,
} from '../../types/constraint';
import type { ExecutionTrace } from '../../types/trace';
import { IRON_LAWS, GUIDELINES, PROMPTS } from './definitions';
import type { MergedConstraintsConfig } from '../../types/project-config';
import { matchesTrigger } from '../../utils/exec';
import { join, relative } from 'path';
import { CheckCache } from './check-cache';
import { findTsSourceFiles } from '../../utils/file-walk';
import { getConstraintCheck, buildCheckEnv, type CheckOutcome } from './checkers';
import { createGitEvidence, type GitEvidence } from './git-evidence';

/**
 * trace 记录器最小接口（工单 15 decycle 收尾，harness#88）
 *
 * core 不上行依赖 monitoring：记录器经**构造参数**注入，未注入 = no-op
 * （默认无副作用）。真实收集器由组合根接线——CLI check/report 与 bootstrap
 * 各自 `new ConstraintChecker(getTraceCollector())`。
 */
export interface TraceRecorder {
  record(trace: ExecutionTrace): void;
}

/** 未注入时的默认记录器：不记录 */
const NOOP_TRACE_RECORDER: TraceRecorder = { record: () => undefined };

/**
 * 约束检查器
 */
export class ConstraintChecker {
  private static instance: ConstraintChecker;

  /** 检查结果缓存（S7：src 扫描等重复 I/O，TTL=1s 防跨测试污染） */
  private cache: CheckCache = new CheckCache({ ttlMs: 1000 });

  /** trace 记录器（构造注入；缺省 no-op） */
  private readonly traceRecorder: TraceRecorder;

  constructor(traceRecorder: TraceRecorder = NOOP_TRACE_RECORDER) {
    this.traceRecorder = traceRecorder;
  }

  /**
   * 获取单例实例（未接线记录器的默认实例：不写 trace）
   */
  static getInstance(): ConstraintChecker {
    if (!ConstraintChecker.instance) {
      ConstraintChecker.instance = new ConstraintChecker();
    }
    return ConstraintChecker.instance;
  }

  /**
   * 获取当前的约束集合（内置 + 自定义）
   *
   * 纯查询，无副作用（ADR-0006：原 `.check` 装配已随唯一消费者
   * interceptor 的删除一并移除，ADR-0004）。
   *
   * @param customConfig 可选，per-request 自定义配置；不传则返回内置约束集
   */
  getConstraints(customConfig?: MergedConstraintsConfig | null): {
    ironLaws: Record<string, Constraint>;
    guidelines: Record<string, Constraint>;
    prompts: Record<string, Constraint>;
  } {
    const config = customConfig;
    const source = config
      ? { ironLaws: config.ironLaws, guidelines: config.guidelines, prompts: config.prompts ?? PROMPTS }
      : { ironLaws: IRON_LAWS, guidelines: GUIDELINES, prompts: PROMPTS };

    return {
      ironLaws: source.ironLaws,
      guidelines: source.guidelines,
      prompts: source.prompts,
    };
  }

  /**
   * 检查单个约束
   *
   * @param evidence 可选，本 run 的 git 证据实例（#87）；不传 = 本次调用独占一份真 git 证据
   */
  async check(
    constraint: Constraint,
    context: ConstraintContext,
    evidence?: GitEvidence
  ): Promise<ConstraintResult> {
    // prompt 类约束不参与 checker 执行（ADR-0001：仅参与注入）
    if (constraint.kind === 'prompt') {
      return {
        id: constraint.id,
        level: constraint.level,
        satisfied: true,
        constraint,
        checkedAt: new Date(),
      };
    }

    // 检查前置条件（'skip' = 约定未采用/证据未接线：satisfied 置 true 但不计 pass/fail）
    const outcome = await this.checkPrecondition(constraint, context, evidence);

    if (outcome === 'skip') {
      return {
        id: constraint.id,
        level: constraint.level,
        satisfied: true,
        skipped: true,
        constraint,
        message: `约束 ${constraint.id} 跳过评估（约定未采用或证据未接线）`,
        checkedAt: new Date(),
      };
    }

    const satisfied = outcome;

    return {
      id: constraint.id,
      level: constraint.level,
      satisfied,
      constraint,
      message: satisfied ? undefined : constraint.message,
      requiredAction: satisfied ? undefined : constraint.enforcement,
      checkedAt: new Date(),
    };
  }

  /**
   * 根据约束层级获取严重性
   */
  private getSeverity(level: ConstraintLevel): 'error' | 'warning' | 'info' {
    switch (level) {
      case 'iron_law':
        return 'error';
      case 'guideline':
        return 'warning';
      case 'prompt':
        return 'info';
      default:
        return 'warning';
    }
  }

  /**
   * 记录约束检查的 trace
   */
  private recordTrace(
    constraint: Constraint,
    checkResult: ConstraintResult,
    context: ConstraintContext
  ): void {
    this.traceRecorder.record({
      constraintId: constraint.id,
      level: constraint.level,
      timestamp: Date.now(),
      result: checkResult.skipped ? 'skip' : checkResult.satisfied ? 'pass' : 'fail',
      operation: context.operation,
      severity: this.getSeverity(constraint.level),
      projectPath: context.projectPath,
      sessionId: context.sessionId,
    });
  }

  /**
   * 检查约束前置条件（工单 21：分发至 checkers/ 注册表）
   *
   * 注册表闭环（ADR-0001）：kind='check' 未注册 checker 直接抛错，
   * 不再有"未注册默认通过"路径；kind='prompt' 在 check() 入口已短路。
   *
   * git 证据（stagedDiff/stagedDiffNames）单一来源 = GitEvidence adapter（#87）：
   * 一次 run 内调用方传同一实例即至多取证一次，run 外调用独占一份。
   */
  private async checkPrecondition(
    constraint: Constraint,
    context: ConstraintContext,
    evidence?: GitEvidence
  ): Promise<CheckOutcome> {
    const impl = getConstraintCheck(constraint.id);
    if (!impl) {
      throw new Error(
        `[harness] 约束 "${constraint.id}" (kind='check') 未注册 checker，拒绝静默通过。` +
        `请在 checkers/ 注册实现，或将约束改为 kind='prompt'。`
      );
    }

    const projectPath = context.projectPath || process.cwd();
    const git = evidence ?? createGitEvidence(projectPath);
    const env = buildCheckEnv(context, {
      stagedDiff: async () => git.stagedDiff(),
      stagedDiffNames: async () => git.changedFileNames(true),
      srcScan: (root: string) =>
        this.cache.getSync(`src_scan_${root}`, projectPath, () =>
          findTsSourceFiles(join(projectPath, root), { skipIndex: true }).map((f) =>
            relative(projectPath, f)
          )
        ),
    });

    return await impl.evaluate(env);
  }

  /**
   * 查找适用于当前操作的约束
   *
   * @param context 约束上下文
   * @param customConfig 可选，per-request 自定义配置（避免多请求间的单例状态污染）
   */
  findApplicableConstraints(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null
  ): {
    ironLaws: Constraint[];
    guidelines: Constraint[];
    prompts: Constraint[];
  } {
    const operations = [context.operation, ...(context.extraTriggers ?? [])];
    const constraints = this.getConstraints(customConfig);

    const filterByTrigger = (constraintSet: Record<string, Constraint>): Constraint[] => {
      return Object.values(constraintSet).filter(constraint =>
        matchesTrigger(constraint, operations)
      );
    };

    return {
      ironLaws: filterByTrigger(constraints.ironLaws),
      guidelines: filterByTrigger(constraints.guidelines),
      prompts: filterByTrigger(constraints.prompts),
    };
  }

  /**
   * 执行约束检查
   *
   * - Iron Laws：检查失败立即抛出异常
   * - Guidelines：检查失败记录警告
   *
   * @param context 约束上下文
   * @param customConfig 可选，per-request 自定义配置（避免多请求间的单例状态污染）
   * @param evidence 可选，本 run 的 git 证据 adapter（#87）。调用方（CLI check）与
   *   buildConstraintContext 传同一实例 → 一次 run 内 git 取证单一来源；
   *   不传则本 run 自建一份，run 级 memo 照样生效（memo 在实例层，非隐式全局）。
   */
  async checkConstraints(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null,
    evidence?: GitEvidence
  ): Promise<ConstraintCheckResult> {
    // run 起始：重置 src 扫描缓存（S7）；git 证据 = 本 run 独占的 adapter 实例（工单 18 → #87）
    this.cache.invalidate();
    const run = evidence ?? createGitEvidence(context.projectPath || process.cwd());

    const result: ConstraintCheckResult = {
      ironLaws: [],
      guidelines: [],
      passed: true,
      warningCount: 0,
    };

    const constraints = this.getConstraints(customConfig);
    // context.operation 为主触发条件，extraTriggers 为次级推断（ADR-0001），任一命中即匹配
    const operations = [context.operation, ...(context.extraTriggers ?? [])];

    // 1. Iron Laws: 必须全部通过
    for (const constraint of Object.values(constraints.ironLaws)) {
      if (!matchesTrigger(constraint, operations)) continue;

      const checkResult = await this.check(constraint, context, run);
      result.ironLaws.push(checkResult);
      this.recordTrace(constraint, checkResult, context);

      if (!checkResult.satisfied) {
        result.passed = false;
        throw new ConstraintViolationError(checkResult);
      }
    }

    // 2. Guidelines: 记录警告
    for (const constraint of Object.values(constraints.guidelines)) {
      if (!matchesTrigger(constraint, operations)) continue;

      const checkResult = await this.check(constraint, context, run);
      result.guidelines.push(checkResult);
      this.recordTrace(constraint, checkResult, context);

      if (!checkResult.satisfied) {
        result.warningCount++;
      }
    }

    return result;
  }

  /**
   * 执行前检查（仅检查 Iron Laws）
   *
   * @param context 约束上下文
   * @param customConfig 可选，per-request 自定义配置（避免多请求间的单例状态污染）
   * @param evidence 可选，本次检查共用的 git 证据 adapter（#87，同 checkConstraints）
   * @throws ConstraintViolationError 如果有铁律违规
   */
  async beforeExecution(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null,
    evidence?: GitEvidence
  ): Promise<void> {
    const run = evidence ?? createGitEvidence(context.projectPath || process.cwd());
    const constraints = this.getConstraints(customConfig);
    const operations = [context.operation, ...(context.extraTriggers ?? [])];

    for (const constraint of Object.values(constraints.ironLaws)) {
      if (!matchesTrigger(constraint, operations)) continue;

      const result = await this.check(constraint, context, run);
      if (!result.satisfied) {
        throw new ConstraintViolationError(result);
      }
    }
  }
}

// ========================================
// 快捷函数
// ========================================

/**
 * 快捷函数：检查约束
 *
 * @param customConfig 可选，per-request 自定义配置；不传则返回内置约束集
 */
export async function checkConstraint(
  constraintId: string,
  context: ConstraintContext,
  customConfig?: MergedConstraintsConfig | null
): Promise<ConstraintResult> {
  const checker = ConstraintChecker.getInstance();
  const constraints = checker.getConstraints(customConfig);

  const constraint =
    constraints.ironLaws[constraintId] ||
    constraints.guidelines[constraintId] ||
    constraints.prompts[constraintId];

  if (!constraint) {
    return {
      id: constraintId,
      level: 'guideline',
      satisfied: false,
      message: `未知的约束: ${constraintId}`,
      checkedAt: new Date(),
    };
  }

  return checker.check(constraint, context);
}

/**
 * checkConstraints 选项（ADR-0003：包根/子路径统一 options 对象签名）
 */
export interface CheckConstraintsOptions {
  /** 每条约束检查后的回调（用于记录 trace 到外部存储） */
  onTrace?: (result: ConstraintResult) => void;
  /** 可选，per-request 自定义约束配置；不传则用内置约束集 */
  customConfig?: MergedConstraintsConfig | null;
}

/**
 * 快捷函数：执行三层检查
 *
 * @param context 约束上下文
 * @param options.onTrace 每条约束检查后的回调（用于记录 trace 到外部存储）
 * @param options.customConfig 可选，per-request 自定义约束配置；不传则用内置约束集
 */
export async function checkConstraints(
  context: ConstraintContext,
  options?: CheckConstraintsOptions
): Promise<ConstraintCheckResult> {
  const result = await ConstraintChecker.getInstance().checkConstraints(context, options?.customConfig ?? null);
  if (options?.onTrace) {
    for (const r of result.ironLaws) options.onTrace(r);
    for (const r of result.guidelines) options.onTrace(r);
  }
  return result;
}

/**
 * 快捷函数：执行前检查
 *
 * @param context 约束上下文
 * @param customConfig 可选，per-request 自定义配置
 */
export async function checkBeforeExecution(
  context: ConstraintContext,
  customConfig?: MergedConstraintsConfig | null
): Promise<void> {
  return ConstraintChecker.getInstance().beforeExecution(context, customConfig);
}

// 导出单例（未接线记录器：只评估约束，不写 trace；写 trace 由组合根自行 new）
export const constraintChecker = ConstraintChecker.getInstance();
