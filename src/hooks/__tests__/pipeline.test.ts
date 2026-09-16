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
