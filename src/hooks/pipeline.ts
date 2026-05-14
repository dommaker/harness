/**
 * HookPipeline — hook 有序执行、错误隔离、采样
 *
 * 执行顺序：before hooks → consumer operation → after hooks
 * 每个 hook 独立 try/catch，单个 hook 失败不影���其他 hook。
 */

import type {
  HookDefinition,
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
        if (hook.errorStrategy === 'warn') {
          warnings.push(hook.name);
        }
        // 'ignore' 策略静默跳过
      }
    }

    return { passed, records, blockedBy, warnings };
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
    hook: HookDefinition<C, unknown>,
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
