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
  ConstraintTrigger,
  ConstraintLevel,
  ConstraintViolationError,
} from '../../types/constraint';
import type { ExecutionTrace } from '../../types/trace';
import { getTraceCollector } from '../../monitoring/traces';
import { IRON_LAWS, GUIDELINES, PROMPTS } from './definitions';
import type { MergedConstraintsConfig } from '../../types/project-config';
import { normalizeTriggers } from '../../utils/exec';
import { runCommand } from '../../utils/exec';
import { join, relative } from 'path';
import { CheckCache } from './check-cache';
import { findTsSourceFiles } from '../../utils/file-walk';
import { getConstraintCheck, type CheckEnv, type CheckOutcome } from './checkers';

/**
 * 例外名称 → ConstraintContext 中布尔字段的映射
 */
const EXCEPTION_FIELD_MAP: Record<string, keyof ConstraintContext> = {
  scalability_required: 'scalabilityRequired',
  security_required: 'securityRequired',
  performance_required: 'performanceRequired',
  reliability_required: 'reliabilityRequired',
  simple_typo: 'isSimpleTypo',
  config_value_error: 'isConfigValueError',
  missing_config: 'isMissingConfig',
  config_file: 'isConfigFile',
  type_definition: 'isTypeDefinition',
  simple_accessor: 'isSimpleAccessor',
  pure_display_component: 'isPureDisplayComponent',
  json_parse_result: 'isJsonParseResult',
  third_party_no_types: 'isThirdPartyNoTypes',
  legacy_migration: 'isLegacyMigration',
  internal_refactor: 'isInternalRefactor',
  bug_fix_only: 'isBugFixOnly',
  performance_optimization: 'isPerformanceOptimization',
  redundant_code_cleanup: 'isRedundantCodeCleanup',
  same_effect_refactor: 'isSameEffectRefactor',
  unused_code_removal: 'isUnusedCodeRemoval',
  external_dependency: 'isExternalDependency',
  explicit_instruction: 'isExplicitInstruction',
  emergency_fix: 'isEmergencyFix',
  existing_design: 'isExistingDesign',
};

/**
 * trace 记录器最小接口（原工单 15 为消除 core→monitoring 循环；现 monitoring
 * 不反向依赖 core，方向单向、无环，checker 可直接值引用 getTraceCollector）
 *
 * checker 不构造收集器；生产路径首次记录时惰性接线 getTraceCollector()
 * （幂等单点，ADR-0003），测试可经 setTraceRecorder 注入替身。
 */
export interface TraceRecorder {
  record(trace: ExecutionTrace): void;
}

/**
 * 约束检查器
 */
export class ConstraintChecker {
  private static instance: ConstraintChecker;

  /** 检查结果缓存（S7：src 扫描等重复 I/O，TTL=1s 防跨测试污染） */
  private cache: CheckCache = new CheckCache({ ttlMs: 1000 });

  /**
   * run 级 memo（工单 18）：一次 checkConstraints/checkConstraintsSafe 内
   * git diff 等命令只执行一次；run 外直接调用私有检查方法时不 memo（恒新鲜）。
   */
  private runCache: Map<string, Promise<string>> | null = null;

  /** trace 记录器（注入式；null = 未显式注入，首次记录时惰性接线全局收集器） */
  private traceRecorder: TraceRecorder | null = null;

  private constructor() {}

  /**
   * 取 trace 记录器：未显式注入时惰性接线全局收集器（幂等，ADR-0003 副作用收敛）
   */
  private getRecorder(): TraceRecorder {
    if (!this.traceRecorder) {
      this.traceRecorder = getTraceCollector();
    }
    return this.traceRecorder;
  }

  /**
   * run 内 memoize；无活动 run 时直接执行（工单 18）
   */
  private memoRun(key: string, fn: () => Promise<string>): Promise<string> {
    if (!this.runCache) return fn();
    let pending = this.runCache.get(key);
    if (!pending) {
      pending = fn();
      this.runCache.set(key, pending);
    }
    return pending;
  }

  /**
   * staged 全量 diff（同一次 run 内只执行一次 git 命令，工单 18）
   */
  private getStagedDiff(projectPath: string): Promise<string> {
    return this.memoRun(`git_diff_staged:${projectPath}`, () =>
      runCommand('git diff --cached', projectPath)
    );
  }

  /**
   * staged 变更文件名列表（同一次 run 内只执行一次 git 命令，工单 18）
   */
  private getStagedDiffNames(projectPath: string): Promise<string> {
    return this.memoRun(`git_diff_staged_names:${projectPath}`, () =>
      runCommand('git diff --cached --name-only', projectPath)
    );
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ConstraintChecker {
    if (!ConstraintChecker.instance) {
      ConstraintChecker.instance = new ConstraintChecker();
    }
    return ConstraintChecker.instance;
  }

  /**
   * 注入 trace 记录器（测试/定制场景；不调用则首次记录时惰性接线全局收集器）
   */
  setTraceRecorder(recorder: TraceRecorder): void {
    this.traceRecorder = recorder;
  }

  /**
   * 获取当前的约束集合（内置 + 自定义）
   *
   * @param customConfig 可选，per-request 自定义配置；不传则返回内置约束集
   */
  getConstraints(customConfig?: MergedConstraintsConfig | null): {
    ironLaws: Record<string, Constraint & { check: (ctx: ConstraintContext) => Promise<ConstraintResult> }>;
    guidelines: Record<string, Constraint & { check: (ctx: ConstraintContext) => Promise<ConstraintResult> }>;
    prompts: Record<string, Constraint & { check: (ctx: ConstraintContext) => Promise<ConstraintResult> }>;
  } {
    const config = customConfig;
    const source = config
      ? { ironLaws: config.ironLaws, guidelines: config.guidelines, prompts: config.prompts ?? PROMPTS }
      : { ironLaws: IRON_LAWS, guidelines: GUIDELINES, prompts: PROMPTS };

    // Wire unified check() method on every constraint
    const wire = (constraints: Record<string, Constraint>) => {
      for (const c of Object.values(constraints)) {
        (c as any).check = (ctx: ConstraintContext) => this.check(c, ctx);
      }
      return constraints as Record<string, Constraint & { check: (ctx: ConstraintContext) => Promise<ConstraintResult> }>;
    };
    return {
      ironLaws: wire(source.ironLaws),
      guidelines: wire(source.guidelines),
      prompts: wire(source.prompts),
    };
  }

  /**
   * 检查单个约束
   */
  async check(
    constraint: Constraint,
    context: ConstraintContext
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

    // 检查例外条件（仅 Guidelines 有效）
    if (constraint.level === 'guideline' && constraint.exceptions) {
      if (this.checkException(constraint, context)) {
        return {
          id: constraint.id,
          level: constraint.level,
          satisfied: true,
          constraint,
          message: `指导原则 ${constraint.id} 因例外条件被豁免`,
          checkedAt: new Date(),
        };
      }
    }

    // 检查前置条件（'skip' = 约定未采用/证据未接线：satisfied 置 true 但不计 pass/fail）
    const outcome = await this.checkPrecondition(constraint, context);

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
   * 检查例外条件
   */
  private checkException(constraint: Constraint, context: ConstraintContext): boolean {
    if (!constraint.exceptions) return false;
    return constraint.exceptions.some(
      (ex) => context[EXCEPTION_FIELD_MAP[ex]] === true
    );
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
   * 判断约束是否匹配当前触发条件
   *
   * context.operation 为主触发条件，context.extraTriggers 为次级推断
   * （ADR-0001：pre-commit 代码变更附加 code_implementation），任一命中即匹配。
   */
  private matchesTrigger(constraint: Constraint, context: ConstraintContext): boolean {
    const triggers = normalizeTriggers<ConstraintTrigger>(constraint.trigger);
    const operations = [context.operation, ...(context.extraTriggers ?? [])];
    return operations.some(op => triggers.includes(op));
  }

  /**
   * 记录约束检查的 trace
   */
  private recordTrace(
    collector: TraceRecorder,
    constraint: Constraint,
    checkResult: ConstraintResult,
    context: ConstraintContext
  ): void {
    collector.record({
      constraintId: constraint.id,
      level: constraint.level,
      timestamp: Date.now(),
      result: checkResult.skipped ? 'skip' : checkResult.satisfied ? 'pass' : 'fail',
      operation: context.operation,
      severity: this.getSeverity(constraint.level),
      exceptionApplied: checkResult.message?.includes('豁免')
        ? constraint.exceptions?.[0]
        : undefined,
      projectPath: context.projectPath,
      sessionId: context.sessionId,
    });
  }

  /**
   * 检查约束前置条件（工单 21：分发至 checkers/ 注册表）
   *
   * 注册表闭环（ADR-0001）：kind='check' 未注册 checker 直接抛错，
   * 不再有"未注册默认通过"路径；kind='prompt' 在 check() 入口已短路。
   */
  private async checkPrecondition(
    constraint: Constraint,
    context: ConstraintContext
  ): Promise<CheckOutcome> {
    const impl = getConstraintCheck(constraint.id);
    if (!impl) {
      throw new Error(
        `[harness] 约束 "${constraint.id}" (kind='check') 未注册 checker，拒绝静默通过。` +
        `请在 checkers/ 注册实现，或将约束改为 kind='prompt'。`
      );
    }

    const projectPath = context.projectPath || process.cwd();
    const env: CheckEnv = {
      context,
      projectPath,
      stagedDiff: () => this.getStagedDiff(projectPath),
      stagedDiffNames: () => this.getStagedDiffNames(projectPath),
      srcScan: (root: string) =>
        this.cache.getSync(`src_scan_${root}`, projectPath, () =>
          findTsSourceFiles(join(projectPath, root), { skipIndex: true }).map((f) =>
            relative(projectPath, f)
          )
        ),
    };

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
      return Object.values(constraintSet).filter(constraint => {
        const triggers = Array.isArray(constraint.trigger)
          ? constraint.trigger
          : [constraint.trigger];
        return operations.some(op => triggers.includes(op));
      });
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
   */
  async checkConstraints(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null
  ): Promise<ConstraintCheckResult> {
    // run 起始：重置 run 级缓存；run 结束（含铁律提前抛出）清空（工单 18）
    this.cache.invalidate();
    this.runCache = new Map();

    try {
      const result: ConstraintCheckResult = {
        ironLaws: [],
        guidelines: [],
        passed: true,
        warningCount: 0,
      };

      const traceCollector = this.getRecorder();
      const constraints = this.getConstraints(customConfig);

      // 1. Iron Laws: 必须全部通过
      for (const constraint of Object.values(constraints.ironLaws)) {
        if (!this.matchesTrigger(constraint, context)) continue;

        const checkResult = await this.check(constraint, context);
        result.ironLaws.push(checkResult);
        this.recordTrace(traceCollector, constraint, checkResult, context);

        if (!checkResult.satisfied) {
          result.passed = false;
          throw new ConstraintViolationError(checkResult);
        }
      }

      // 2. Guidelines: 记录警告
      for (const constraint of Object.values(constraints.guidelines)) {
        if (!this.matchesTrigger(constraint, context)) continue;

        const checkResult = await this.check(constraint, context);
        result.guidelines.push(checkResult);
        this.recordTrace(traceCollector, constraint, checkResult, context);

        if (!checkResult.satisfied) {
          result.warningCount++;
        }
      }

      return result;
    } finally {
      this.runCache = null;
    }
  }

  /**
   * S11: 安全全量检查 — 全部约束检查，不抛异常
   *
   * 区别 checkConstraints(): Iron Law 违规收集在结果中而不是抛异常。
   * 调用方通过 result.passed + result.warningCount 判断状态。
   */
  async checkConstraintsSafe(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null
  ): Promise<ConstraintCheckResult> {
    // run 起始：重置 run 级缓存（工单 18）
    this.cache.invalidate();
    this.runCache = new Map();

    try {
      const result: ConstraintCheckResult = {
        ironLaws: [],
        guidelines: [],
        passed: true,
        warningCount: 0,
      };

      const traceCollector = this.getRecorder();
      const constraints = this.getConstraints(customConfig);

      for (const constraint of Object.values(constraints.ironLaws)) {
        if (!this.matchesTrigger(constraint, context)) continue;
        const checkResult = await this.check(constraint, context);
        result.ironLaws.push(checkResult);
        this.recordTrace(traceCollector, constraint, checkResult, context);
        if (!checkResult.satisfied) result.passed = false;
      }

      for (const constraint of Object.values(constraints.guidelines)) {
        if (!this.matchesTrigger(constraint, context)) continue;
        const checkResult = await this.check(constraint, context);
        result.guidelines.push(checkResult);
        this.recordTrace(traceCollector, constraint, checkResult, context);
        if (!checkResult.satisfied) result.warningCount++;
      }

      return result;
    } finally {
      this.runCache = null;
    }
  }

  /**
   * 执行前检查（仅检查 Iron Laws）
   *
   * @param context 约束上下文
   * @param customConfig 可选，per-request 自定义配置（避免多请求间的单例状态污染）
   * @throws ConstraintViolationError 如果有铁律违规
   */
  async beforeExecution(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null
  ): Promise<void> {
    const constraints = this.getConstraints(customConfig);
    const operations = [context.operation, ...(context.extraTriggers ?? [])];

    for (const constraint of Object.values(constraints.ironLaws)) {
      if (!normalizeTriggers(constraint.trigger).some((t) => operations.includes(t))) continue;

      const result = await this.check(constraint, context);
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
 * S11: 快捷函数 — 安全全量检查（不抛异常）
 */
export async function checkConstraintsSafe(
  context: ConstraintContext,
  customConfig?: MergedConstraintsConfig | null
): Promise<ConstraintCheckResult> {
  return ConstraintChecker.getInstance().checkConstraintsSafe(context, customConfig);
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

// 导出单例
export const constraintChecker = ConstraintChecker.getInstance();
