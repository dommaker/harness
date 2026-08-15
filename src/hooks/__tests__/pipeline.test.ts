/**
 * HookPipeline errorStrategy 语义测试（G7 映射语义确认）
 *
 * block/warn 行为是 studio safeCallHook 语义在管线侧的无损承载面：
 * - 'block'：hook 失败 → passed=false、blockedBy 记名、停止执行后续 hook
 * - 'warn'：hook 失败 → 记录警告、继续执行后续 hook、passed 不受影响
 * - 'ignore'/未声明：静默跳过（历史行为保留）
 */

import { HookPipeline } from '../pipeline';
import { HookRegistry } from '../registry';
import type { HookDefinition } from '../types';

function makeRegistry(hooks: HookDefinition[]): { registry: HookRegistry; pipeline: HookPipeline } {
  const registry = new HookRegistry();
  registry.registerAll(hooks);
  return { registry, pipeline: new HookPipeline(registry) };
}

describe('HookPipeline errorStrategy 语义', () => {
  it('block：失败阻断管线（passed=false、blockedBy 记名、停止后续 hook）', async () => {
    const second = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { name: 'first', phase: 'before', errorStrategy: 'block', execute: async () => ({ passed: false, error: 'boom' }) },
      { name: 'second', phase: 'before', execute: second },
    ]);

    const result = await pipeline.run('before', {});

    expect(result.passed).toBe(false);
    expect(result.blockedBy).toEqual(['first']);
    expect(second).not.toHaveBeenCalled();
  });

  it('warn：失败记录警告并继续（passed 不受影响、后续 hook 照常执行）', async () => {
    const second = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { name: 'first', phase: 'before', errorStrategy: 'warn', execute: async () => ({ passed: false, error: 'soft' }) },
      { name: 'second', phase: 'before', execute: second },
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
      { name: 'blocker', phase: 'before', errorStrategy: 'block', execute: async () => ({ passed: false }) },
      { name: 'afterHook', phase: 'after', execute: afterHook },
    ]);

    const before = await pipeline.run('before', {});
    expect(before.passed).toBe(false);

    const after = await pipeline.run('after', {});
    expect(after.passed).toBe(true);
    expect(afterHook).toHaveBeenCalled();
  });

  it('未声明 errorStrategy：静默跳过（历史行为保留）', async () => {
    const second = jest.fn().mockResolvedValue({ passed: true });
    const { pipeline } = makeRegistry([
      { name: 'first', phase: 'before', execute: async () => ({ passed: false }) },
      { name: 'second', phase: 'before', execute: second },
    ]);

    const result = await pipeline.run('before', {});

    expect(result.passed).toBe(true);
    expect(result.blockedBy).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(second).toHaveBeenCalled();
  });
});
