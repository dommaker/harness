/**
 * HookPipeline errorStrategy 语义测试（G7 映射语义确认）
 *
 * block/warn 行为是 studio safeCallHook 语义在管线侧的无损承载面：
 * - 'block'：hook 失败 → passed=false、blockedBy 记名、停止执行后续 hook
 * - 'warn'：hook 失败 → 记录警告、继续执行后续 hook、passed 不受影响
 *
 * #159 起 `enabled` / `errorStrategy` 的唯一声明点是 HookConfig：
 * HookDefinition 不再携带这两个字段，有效值在注册环节由配置表填充。
 */

import { HookPipeline } from '../pipeline';
import { HookRegistry } from '../registry';
import type { HookConfig, HookDefinition } from '../types';

function makeConfig(name: string, overrides: Partial<HookConfig> = {}): HookConfig {
  return { name, enabled: true, errorStrategy: 'warn', ...overrides };
}

function makeRegistry(
  entries: Array<{ hook: HookDefinition; config?: Partial<HookConfig> }>
): { registry: HookRegistry; pipeline: HookPipeline } {
  const registry = new HookRegistry();
  for (const { hook, config } of entries) {
    registry.register(hook, makeConfig(hook.name, config));
  }
  return { registry, pipeline: new HookPipeline(registry) };
}

describe('HookPipeline errorStrategy 语义', () => {
  it('block：失败阻断管线（passed=false、blockedBy 记名、停止后续 hook）', async () => {
    const second = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { hook: { name: 'first', phase: 'before', execute: async () => ({ passed: false, error: 'boom' }) }, config: { errorStrategy: 'block' } },
      { hook: { name: 'second', phase: 'before', execute: second } },
    ]);

    const result = await pipeline.run('before', {});

    expect(result.passed).toBe(false);
    expect(result.blockedBy).toEqual(['first']);
    expect(second).not.toHaveBeenCalled();
  });

  it('warn：失败记录警告并继续（passed 不受影响、后续 hook 照常执行）', async () => {
    const second = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { hook: { name: 'first', phase: 'before', execute: async () => ({ passed: false, error: 'soft' }) }, config: { errorStrategy: 'warn' } },
      { hook: { name: 'second', phase: 'before', execute: second } },
    ]);

    const result = await pipeline.run('before', {});

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual(['first']);
    expect(result.blockedBy).toEqual([]);
    expect(second).toHaveBeenCalled();
  });

  it('block 失败停在当前 phase，不改变其它 phase 的 hook', async () => {
    const afterHook = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { hook: { name: 'blocker', phase: 'before', execute: async () => ({ passed: false }) }, config: { errorStrategy: 'block' } },
      { hook: { name: 'afterHook', phase: 'after', execute: afterHook } },
    ]);

    const before = await pipeline.run('before', {});
    expect(before.passed).toBe(false);

    const after = await pipeline.run('after', {});
    expect(after.passed).toBe(true);
    expect(afterHook).toHaveBeenCalled();
  });

  it('配置 enabled:false 的 hook 不进入管线执行（配置表是唯一声明点）', async () => {
    const disabledHook = jest.fn().mockResolvedValue({ passed: true });
    const enabledHook = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { hook: { name: 'disabled', phase: 'before', execute: disabledHook }, config: { enabled: false } },
      { hook: { name: 'enabled', phase: 'before', execute: enabledHook } },
    ]);

    const result = await pipeline.run('before', {});

    expect(result.passed).toBe(true);
    expect(disabledHook).not.toHaveBeenCalled();
    expect(enabledHook).toHaveBeenCalled();
    expect(result.records.map(r => r.hookName)).toEqual(['enabled']);
  });
});

describe('HookPipeline.runOne 按名执行单个 hook（#167）', () => {
  it('按名执行并返回观测记录，不连带其它 hook', async () => {
    const other = jest.fn().mockResolvedValue({ passed: true });
    const target = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { hook: { name: 'target', phase: 'before', execute: target } },
      { hook: { name: 'other', phase: 'before', execute: other } },
    ]);

    const record = await pipeline.runOne('target', {});

    expect(record.hookName).toBe('target');
    expect(record.phase).toBe('before');
    expect(record.passed).toBe(true);
    expect(record.skipped).toBeUndefined();
    expect(typeof record.durationMs).toBe('number');
    expect(target).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('enabled:false → 实现体零调用，返回 skipped:true / passed:true 记录', async () => {
    const disabled = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { hook: { name: 'disabled', phase: 'before', execute: disabled }, config: { enabled: false } },
    ]);

    const record = await pipeline.runOne('disabled', {});

    expect(disabled).not.toHaveBeenCalled();
    expect(record.skipped).toBe(true);
    expect(record.passed).toBe(true);
    expect(record.hookName).toBe('disabled');
  });

  it('block + 实现体抛错 → 抛错，message 含 hook 名与原文', async () => {
    const { pipeline } = makeRegistry([
      {
        hook: { name: 'guard', phase: 'before', execute: async () => { throw new Error('iron-law violated'); } },
        config: { errorStrategy: 'block' },
      },
    ]);

    await expect(pipeline.runOne('guard', {})).rejects.toThrow('iron-law violated');
    await expect(pipeline.runOne('guard', {})).rejects.toThrow('[harness] hook "guard" blocked:');
  });

  it('block + 实现体返回 passed:false → 抛错，message 含 result.error 原文', async () => {
    const { pipeline } = makeRegistry([
      { hook: { name: 'guard', phase: 'before', execute: async () => ({ passed: false, error: 'boom' }) }, config: { errorStrategy: 'block' } },
    ]);

    await expect(pipeline.runOne('guard', {})).rejects.toThrow('[harness] hook "guard" blocked: boom');
  });

  it('warn + 失败 → resolve，返回 passed:false 带 error 的记录', async () => {
    const { pipeline } = makeRegistry([
      {
        hook: { name: 'soft', phase: 'before', execute: async () => { throw new Error('soft-fail'); } },
        config: { errorStrategy: 'warn' },
      },
    ]);

    const record = await pipeline.runOne('soft', {});

    expect(record.passed).toBe(false);
    expect(record.error).toBe('soft-fail');
    expect(record.skipped).toBeUndefined();
  });

  it('未知 hook 名 → 抛错（与注册表闭环口径一致，不静默跳过）', async () => {
    const { pipeline } = makeRegistry([
      { hook: { name: 'known', phase: 'before', execute: async () => ({ passed: true }) } },
    ]);

    await expect(pipeline.runOne('no_such_hook', {})).rejects.toThrow('no_such_hook');
    await expect(pipeline.runOne('no_such_hook', {})).rejects.toThrow('未注册');
  });

  it('sampleRate < 1 时采样语义与 run 路径一致（未抽中 → 零调用 + sampled 记录）', async () => {
    const execute = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { hook: { name: 'sampled', phase: 'before', sampleRate: 0.5, execute } },
    ]);

    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const record = await pipeline.runOne('sampled', {});
      expect(execute).not.toHaveBeenCalled();
      expect(record.sampled).toBe(true);
      expect(record.passed).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }

    const hitSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      const record = await pipeline.runOne('sampled', {});
      expect(execute).toHaveBeenCalledTimes(1);
      expect(record.sampled).toBeUndefined();
    } finally {
      hitSpy.mockRestore();
    }
  });
});
