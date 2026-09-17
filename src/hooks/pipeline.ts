/**
 * HookPipeline — hook 有序执行、错误隔离、采样
 *
 * 执行顺序：before hooks → consumer operation → after hooks
 * 每个 hook 独立 try/catch，单个 hook 失败不影���其他 hook。
 */

import type {
  EffectiveHook,
  HookPhase,
  HookExecutionRecord,
  PipelineResult,
} from './types';
import type { HookRegistry } from './registry';

export class HookPipeline<C = unknown> {
  private registry: HookRegistry<C, unknown>;

  constructor(registry: HookRegistry<C, unknown>) {
    this.registry = registry;
  }

  /**
   * 执行指定 phase 的所有 enabled hook
   *
   * @param phase hook 时机
   * @param context 传递给每个 hook 的上下文
   * @returns 管线执行结果
   */
  async run(
    phase: HookPhase,
    context: C
  ): Promise<PipelineResult> {
    const hooks = this.registry.getEnabled(phase);
    const records: HookExecutionRecord[] = [];
    const blockedBy: string[] = [];
    const warnings: string[] = [];
    let passed = true;

    for (const hook of hooks) {
      const record = await this.executeOne(hook, context);
      records.push(record);

      if (!record.passed) {
        if (hook.errorStrategy === 'block') {
          passed = false;
          blockedBy.push(hook.name);
          break; // blocking hook 失败，停止执行后续 hook
        }
        // 'warn'：记录警告继续（有效集合仅 block/warn，策略由 HookConfig 必填声明）
        warnings.push(hook.name);
      }
    }

    return { passed, records, blockedBy, warnings };
  }

  /**
   * 按名执行单个 hook（#167）
   *
   * 与 run() 共用 executeOne 的采样与错误隔离路径（判定与错误策略的实现体
   * 只有一份）；enabled / errorStrategy 的值来源仍是注册环节填充的
   * EffectiveHook（唯一声明点 HookConfig，#159）。
   *
   * - enabled:false → 实现体零调用，返回 skipped:true / passed:true 记录
   *   （镜像 sampled 先例：未执行 = 记录上一面旗，不是异常）
   * - errorStrategy 'block' 且失败 → 抛 Error（message 含 hook 名与原文）；
   *   'warn' 且失败 → resolve，返回 passed:false 带 error 的记录
   * - 未知名 → 抛错（与 assertHookRegistryClosed 闭环口径一致，拒绝静默缺失）
   *
   * @param name hook 名称（须已注册）
   * @param context 传递给 hook 的上下文
   * @returns 管线观测记录
   */
  async runOne(name: string, context: C): Promise<HookExecutionRecord> {
    const hook = this.registry.get(name);
    if (!hook) {
      throw new Error(
        `[harness] hook 执行失败：hook "${name}" 未注册。请注册同名 HookDefinition 与 HookConfig 声明。`
      );
    }

    if (!hook.enabled) {
      const now = Date.now();
      return {
        hookName: hook.name,
        phase: hook.phase,
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        passed: true,
        skipped: true,
      };
    }

    const record = await this.executeOne(hook, context);
    if (!record.passed && hook.errorStrategy === 'block') {
      throw new Error(
        `[harness] hook "${hook.name}" blocked: ${record.error ?? '未知错误'}`
      );
    }
    return record;
  }

  /**
   * 执行 before + after 全套管线
   *
   * @param context 上下文
   * @param operation 业务操作（在 before 和 after 之间执行）
   * @returns 管线结果 + 操作结果
   */
  async runFull<R>(
    context: C,
    operation: () => Promise<R>
  ): Promise<{ pipelineResult: PipelineResult; operationResult?: R }> {
    // 1. Before hooks
    const beforeResult = await this.run('before', context);
    if (!beforeResult.passed) {
      return { pipelineResult: beforeResult };
    }

    // 2. Execute operation
    let operationResult: R;
    try {
      operationResult = await operation();
    } catch (err) {
      // 操作失败：仍执行 after hooks，但传递错误信息
      const afterResult = await this.run('after', {
        ...context,
        _operationError: (err as Error).message,
      } as unknown as C);
      return {
        pipelineResult: {
          passed: false,
          records: [...beforeResult.records, ...afterResult.records],
          blockedBy: [...beforeResult.blockedBy, '_operation'],
          warnings: [...beforeResult.warnings, ...afterResult.warnings],
        },
      };
    }

    // 3. After hooks
    const afterResult = await this.run('after', context);
    return {
      pipelineResult: {
        passed: beforeResult.passed && afterResult.passed,
        records: [...beforeResult.records, ...afterResult.records],
        blockedBy: [...beforeResult.blockedBy, ...afterResult.blockedBy],
        warnings: [...beforeResult.warnings, ...afterResult.warnings],
      },
      operationResult,
    };
  }

  /**
   * 执行单个 hook（带采样和错误隔离）
   */
  private async executeOne(
    hook: EffectiveHook<C, unknown>,
    context: C
  ): Promise<HookExecutionRecord> {
    const startedAt = Date.now();

    // 采样检查
    if (hook.sampleRate !== undefined && hook.sampleRate < 1) {
      if (Math.random() > hook.sampleRate) {
        return {
          hookName: hook.name,
          phase: hook.phase,
          startedAt,
          completedAt: Date.now(),
          durationMs: 0,
          passed: true,
          sampled: true,
        };
      }
    }

    try {
      const result = await hook.execute(context);
      return {
        hookName: hook.name,
        phase: hook.phase,
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        passed: result.passed !== false,
        error: result.error,
      };
    } catch (err) {
      return {
        hookName: hook.name,
        phase: hook.phase,
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        passed: false,
        error: (err as Error).message,
      };
    }
  }
}
