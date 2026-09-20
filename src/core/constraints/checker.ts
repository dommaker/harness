/**
 * 约束检查引擎
 *
 * severity 显式模型（ADR-0029）：
 * - severity='error'：检查失败立即抛出异常（block 模式）
 * - severity='warning'：检查失败记录警告
 * 全部约束 kind='check'，必须带真实 checker（注册表闭环）。
 */

import {
  Constraint,
  ConstraintContext,
  ConstraintResult,
  ConstraintCheckResult,
  ConstraintViolationError,
} from '../../types/constraint';
import type { ExecutionTrace } from '../../types/trace';
import { CONSTRAINTS } from './definitions';
import type { MergedConstraintsConfig } from '../../types/project-config';
import { matchesTrigger } from './triggers';
import { join, relative } from 'path';
import { CheckCache } from './check-cache';
import { findTsSourceFiles } from '../../utils/file-walk';
import { getConstraintCheck, buildCheckEnv, normalizeCheckOutcome, type CheckOutcome } from './checkers';
import { createGitEvidence, type GitEvidence } from './git-evidence';
import { createRunEnv, type RunEnv } from './run-env';

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
  getConstraints(customConfig?: MergedConstraintsConfig | null): Record<string, Constraint> {
    return customConfig ? customConfig.constraints : CONSTRAINTS;
  }

  /**
   * 检查单个约束
   *
   * @param evidence 可选，本 run 的 git 证据实例（#87）；不传 = 本次调用独占一份真 git 证据
   * @param runEnv 可选，本 run 的运行级观察面（ADR-0023）；不传 = 本次调用独占一份
   */
  async check(
    constraint: Constraint,
    context: ConstraintContext,
    evidence?: GitEvidence,
    runEnv?: RunEnv
  ): Promise<ConstraintResult> {
    // 检查前置条件（'skip' = 约定未采用/证据未接线：satisfied 置 true 但不计 pass/fail）
    const outcome = normalizeCheckOutcome(
      await this.checkPrecondition(constraint, context, evidence, runEnv)
    );

    if (outcome.skipped) {
      return {
        id: constraint.id,
        severity: constraint.severity,
        satisfied: true,
        skipped: true,
        constraint,
        message: `约束 ${constraint.id} 跳过评估（约定未采用或证据未接线）`,
        checkedAt: new Date(),
      };
    }

    const satisfied = outcome.satisfied;

    return {
      id: constraint.id,
      severity: constraint.severity,
      satisfied,
      constraint,
      message: satisfied ? undefined : constraint.message,
      evidence: outcome.evidence.length > 0 ? outcome.evidence : undefined,
      requiredAction: satisfied ? undefined : constraint.enforcement,
      checkedAt: new Date(),
    };
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
      severity: constraint.severity,
      timestamp: Date.now(),
      result: checkResult.skipped ? 'skip' : checkResult.satisfied ? 'pass' : 'fail',
      operation: context.operation,
      projectPath: context.projectPath,
      sessionId: context.sessionId,
      evidence: checkResult.evidence,
    });
  }

  /**
   * 检查约束前置条件（工单 21：分发至 checkers/ 注册表）
   *
   * 注册表闭环（ADR-0001）：kind='check' 未注册 checker 直接抛错，
   * 不再有"未注册默认通过"路径。
   *
   * git 证据（stagedDiff/stagedDiffNames）单一来源 = GitEvidence adapter（#87）：
   * 一次 run 内调用方传同一实例即至多取证一次，run 外调用独占一份。
   * 上行数据（config.yml / trace 尾部 / 源根）同一形状 = RunEnv（ADR-0023）。
   */
  private async checkPrecondition(
    constraint: Constraint,
    context: ConstraintContext,
    evidence?: GitEvidence,
    runEnv?: RunEnv
  ): Promise<CheckOutcome> {
    const impl = getConstraintCheck(constraint.id);
    if (!impl) {
      throw new Error(
        `[harness] 约束 "${constraint.id}" (kind='check') 未注册 checker，拒绝静默通过。` +
        `请在 checkers/ 注册实现（纯文本提示层已随 ADR-0029 关停，文本规则写入项目治理文档）。`
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
    }, runEnv);

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
    errors: Constraint[];
    warnings: Constraint[];
  } {
    const operations = [context.operation, ...(context.extraTriggers ?? [])];
    const constraints = this.getConstraints(customConfig);

    const applicable = Object.values(constraints).filter(constraint =>
      matchesTrigger(constraint, operations)
    );

    return {
      errors: applicable.filter(c => c.severity === 'error'),
      warnings: applicable.filter(c => c.severity === 'warning'),
    };
  }

  /**
   * 执行约束检查
   *
   * - severity='error'：检查失败立即抛出异常
   * - severity='warning'：检查失败记录警告
   *
   * @param context 约束上下文
   * @param customConfig 可选，per-request 自定义配置（避免多请求间的单例状态污染）
   * @param evidence 可选，本 run 的 git 证据 adapter（#87）。调用方（CLI check）与
   *   buildConstraintContext 传同一实例 → 一次 run 内 git 取证单一来源；
   *   不传则本 run 自建一份，run 级 memo 照样生效（memo 在实例层，非隐式全局）。
   * @param runEnv 可选，本 run 的运行级观察面（ADR-0023）。调用方（CLI check）与
   *   buildConstraintContext 传同一实例 → 一次 run 内同一项目文件至多读一次。
   */
  async checkConstraints(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null,
    evidence?: GitEvidence,
    runEnv?: RunEnv
  ): Promise<ConstraintCheckResult> {
    return this.runAllConstraints(context, customConfig, evidence, runEnv, 'block');
  }

  /**
   * 收集模式执行约束检查（harness report 的不抛出口，架构评审候选1）
   *
   * 与 checkConstraints 共享同一检查体，唯一差别是不 throw：
   * error 级违规照进 result.errors、passed=false，后续 error 与 warning 级照常执行，
   * trace 逐条照记。报告类消费者拿全量视图；阻断语义只属于 checkConstraints
   * （throw 契约是 #119 判定证据的外溢面，逐字不动）。
   */
  async collectConstraints(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null,
    evidence?: GitEvidence,
    runEnv?: RunEnv
  ): Promise<ConstraintCheckResult> {
    return this.runAllConstraints(context, customConfig, evidence, runEnv, 'collect');
  }

  /**
   * checkConstraints / collectConstraints 的共享检查体；
   * mode='block' 首个 error 级违规即抛，mode='collect' 全量跑完不抛
   */
  private async runAllConstraints(
    context: ConstraintContext,
    customConfig: MergedConstraintsConfig | null | undefined,
    evidence: GitEvidence | undefined,
    runEnv: RunEnv | undefined,
    mode: 'block' | 'collect'
  ): Promise<ConstraintCheckResult> {
    // run 起始：重置 src 扫描缓存（S7）；git 证据 = 本 run 独占的 adapter 实例（工单 18 → #87）
    this.cache.invalidate();
    const projectPath = context.projectPath || process.cwd();
    const run = evidence ?? createGitEvidence(projectPath);
    // 观察面同一形状（ADR-0023）：调用方传了就共用，没传也只造一枚——逐条 checker 不再各读一遍配置
    const env = runEnv ?? createRunEnv(projectPath);

    const result: ConstraintCheckResult = {
      errors: [],
      warnings: [],
      passed: true,
      warningCount: 0,
    };

    const constraints = this.getConstraints(customConfig);
    // context.operation 为主触发条件，extraTriggers 为次级推断（ADR-0001），任一命中即匹配
    const operations = [context.operation, ...(context.extraTriggers ?? [])];

    // 1. error 级: block 模式首个违规即抛；collect 模式全量收集
    for (const constraint of Object.values(constraints).filter(c => c.severity === 'error')) {
      if (!matchesTrigger(constraint, operations)) continue;

      const checkResult = await this.check(constraint, context, run, env);
      result.errors.push(checkResult);
      this.recordTrace(constraint, checkResult, context);

      if (!checkResult.satisfied) {
        result.passed = false;
        if (mode === 'block') {
          throw new ConstraintViolationError(checkResult);
        }
      }
    }

    // 2. warning 级: 记录警告
    for (const constraint of Object.values(constraints).filter(c => c.severity === 'warning')) {
      if (!matchesTrigger(constraint, operations)) continue;

      const checkResult = await this.check(constraint, context, run, env);
      result.warnings.push(checkResult);
      this.recordTrace(constraint, checkResult, context);

      if (!checkResult.satisfied) {
        result.warningCount++;
      }
    }

    return result;
  }

  /**
   * 执行前检查（仅检查 severity='error' 的约束）
   *
   * @param context 约束上下文
   * @param customConfig 可选，per-request 自定义配置（避免多请求间的单例状态污染）
   * @param evidence 可选，本次检查共用的 git 证据 adapter（#87，同 checkConstraints）
   * @throws ConstraintViolationError 如果有 error 级违规
   */
  async beforeExecution(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null,
    evidence?: GitEvidence
  ): Promise<void> {
    const projectPath = context.projectPath || process.cwd();
    const run = evidence ?? createGitEvidence(projectPath);
    // 独立 run 入口（ADR-0023）：本函数内所有 checker 共用一枚观察面
    const env = createRunEnv(projectPath);
    const constraints = this.getConstraints(customConfig);
    const operations = [context.operation, ...(context.extraTriggers ?? [])];

    for (const constraint of Object.values(constraints).filter(c => c.severity === 'error')) {
      if (!matchesTrigger(constraint, operations)) continue;

      const result = await this.check(constraint, context, run, env);
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

  const constraint = constraints[constraintId];

  if (!constraint) {
    return {
      id: constraintId,
      severity: 'warning',
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
 * 快捷函数：执行约束检查
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
    for (const r of result.errors) options.onTrace(r);
    for (const r of result.warnings) options.onTrace(r);
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
