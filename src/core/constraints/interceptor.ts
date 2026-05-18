/**
 * ConstraintInterceptor - 约束拦截器
 */

import type {
  Constraint,
  ConstraintTrigger,
  ConstraintContext,
  ConstraintLevel,
  ConstraintResult,
} from '../../types/constraint';
import { ConstraintViolationError } from '../../types/constraint';
import { normalizeTriggers } from '../../utils/exec';
import type {
  EnforcementId,
  EnforcementExecutor,
  EnforcementContext,
  EnforcementResult,
  InterceptionResult,
} from '../../types/enforcement';
import { constraintChecker } from './checker';

export class ConstraintInterceptor {
  private static instance: ConstraintInterceptor;
  private executors: Map<EnforcementId, EnforcementExecutor> = new Map();
  private executorSources: Map<EnforcementId, string> = new Map();
  private enabled: boolean = true;
  private skipEnforcements: Set<EnforcementId> = new Set();

  private constructor() {}

  static getInstance(): ConstraintInterceptor {
    if (!ConstraintInterceptor.instance) {
      ConstraintInterceptor.instance = new ConstraintInterceptor();
    }
    return ConstraintInterceptor.instance;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  register(
    enforcementId: EnforcementId,
    executor: EnforcementExecutor,
    source?: string
  ): void {
    this.executors.set(enforcementId, executor);
    if (source) this.executorSources.set(enforcementId, source);
  }

  registerBatch(
    registrations: Array<{
      enforcementId: EnforcementId;
      executor: EnforcementExecutor;
    }>
  ): void {
    for (const { enforcementId, executor } of registrations) {
      this.register(enforcementId, executor);
    }
  }

  unregister(enforcementId: EnforcementId): boolean {
    return this.executors.delete(enforcementId);
  }

  hasExecutor(enforcementId: EnforcementId): boolean {
    return this.executors.has(enforcementId);
  }

  getExecutor(enforcementId: EnforcementId): EnforcementExecutor | undefined {
    return this.executors.get(enforcementId);
  }

  getRegistrations(): { id: EnforcementId; executor: EnforcementExecutor; registeredAt: Date; source?: string }[] {
    return Array.from(this.executors.entries()).map(([id, executor]) => ({
      id,
      executor,
      registeredAt: new Date(),
      source: this.executorSources.get(id),
    }));
  }

  skip(enforcementIds: EnforcementId[]): void {
    for (const id of enforcementIds) {
      this.skipEnforcements.add(id);
    }
  }

  clearSkips(): void {
    this.skipEnforcements.clear();
  }

  async intercept(
    trigger: ConstraintTrigger,
    context: ConstraintContext
  ): Promise<InterceptionResult> {
    if (!this.enabled) {
      return {
        passed: true,
        constraints: [],
        violations: [],
        message: '拦截器已禁用',
        interceptedAt: new Date(),
      };
    }

    const result: InterceptionResult = {
      passed: true,
      constraints: [],
      violations: [],
      interceptedAt: new Date(),
    };

    const constraints = constraintChecker.getConstraints();
    const allConstraints = [
      ...Object.values(constraints.ironLaws),
      ...Object.values(constraints.guidelines),
      ...Object.values(constraints.tips),
    ];

    const applicableConstraints = allConstraints.filter(
      (c) => normalizeTriggers<ConstraintTrigger>(c.trigger).includes(trigger)
    );

    const order: Record<ConstraintLevel, number> = { iron_law: 0, guideline: 1, tip: 2 };
    const ordered = applicableConstraints.sort((a, b) => order[a.level] - order[b.level]);

    for (const constraint of ordered) {
      if (this.skipEnforcements.has(constraint.enforcement)) {
        result.constraints.push({ constraint, skipped: true, skipReason: 'configured to skip' });
        continue;
      }

      // Custom executor overrides built-in check
      const executor = this.executors.get(constraint.enforcement);
      let checkResult: ConstraintResult;

      if (executor) {
        const enforcementContext: EnforcementContext = { ...context, enforcementId: constraint.enforcement, constraint };
        const start = Date.now();
        try {
          const enforcementResult = await executor.execute(enforcementContext);
          enforcementResult.duration = Date.now() - start;
          result.constraints.push({ constraint, enforcementResult });
          checkResult = {
            id: constraint.id, level: constraint.level,
            satisfied: enforcementResult.passed,
            message: enforcementResult.message,
            checkedAt: new Date(),
            constraint,
          };
        } catch (error) {
          if (error instanceof ConstraintViolationError) throw error;
          result.constraints.push({ constraint, enforcementResult: { passed: false, error: (error as Error).message, duration: Date.now() - start } });
          checkResult = { id: constraint.id, level: constraint.level, satisfied: false, message: (error as Error).message, checkedAt: new Date(), constraint };
        }
      } else {
        // Unified: constraint.check(context) delegates to checker
        checkResult = await (constraint as any).check(context);
        result.constraints.push({ constraint, enforcementResult: { passed: checkResult.satisfied, message: checkResult.message } });
      }

      if (!checkResult.satisfied) {
        if (constraint.level === 'iron_law') {
          result.passed = false;
          result.violations.push(constraint);
          throw new ConstraintViolationError(checkResult);
        }
        if (constraint.level === 'guideline') {
          result.violations.push(constraint);
        }
      }
    }

    result.message = result.violations.length === 0 ? '✅ 拦截通过' : `❌ ${result.violations.length} 个约束违规`;
    return result;
  }

  async claim(trigger: ConstraintTrigger, context: ConstraintContext): Promise<void> {
    const result = await this.intercept(trigger, context);
    if (!result.passed) {
      throw new ConstraintViolationError({
        id: result.violations[0]?.id || 'unknown',
        level: 'iron_law',
        satisfied: false,
        message: result.message,
        checkedAt: new Date(),
      });
    }
  }

  async canProceed(trigger: ConstraintTrigger, context: ConstraintContext): Promise<boolean> {
    try {
      return (await this.intercept(trigger, context)).passed;
    } catch {
      return false;
    }
  }
}

export const constraintInterceptor = ConstraintInterceptor.getInstance();

// 注册内置 executors
import { registerDefaultExecutors } from './default-executors';
registerDefaultExecutors();

export async function interceptOperation(
  trigger: ConstraintTrigger,
  context: ConstraintContext
): Promise<InterceptionResult> {
  return constraintInterceptor.intercept(trigger, context);
}

export async function claimOperation(
  trigger: ConstraintTrigger,
  context: ConstraintContext
): Promise<void> {
  return constraintInterceptor.claim(trigger, context);
}
