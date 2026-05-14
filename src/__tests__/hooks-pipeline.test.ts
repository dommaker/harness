/**
 * HookRegistry + HookPipeline 测试（Phase 1）
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { HookRegistry } from '../hooks/registry';
import { HookPipeline } from '../hooks/pipeline';
import type { HookDefinition } from '../hooks/types';

interface TestContext {
  value: string;
  calls: string[];
}

function makeHook(
  name: string,
  opts: Partial<HookDefinition<TestContext, unknown>> = {}
): HookDefinition<TestContext, unknown> {
  return {
    name,
    phase: 'before',
    priority: 100,
    errorStrategy: 'block',
    execute: async (ctx) => {
      ctx.calls.push(name);
      return { passed: true };
    },
    ...opts,
  };
}

describe('HookRegistry', () => {
  let registry: HookRegistry<TestContext, unknown>;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  it('应注册 hook', () => {
    registry.register(makeHook('test'));
    expect(registry.get('test')).toBeDefined();
  });

  it('同名注册应覆盖', () => {
    registry.register(makeHook('test', { priority: 50 }));
    registry.register(makeHook('test', { priority: 90 }));
    expect(registry.get('test')?.priority).toBe(90);
  });

  it('应获取已启用的 hook 按优先级排序', () => {
    registry.register(makeHook('low', { priority: 200 }));
    registry.register(makeHook('high', { priority: 10 }));
    registry.register(makeHook('mid', { priority: 100 }));
    registry.register(makeHook('disabled', { enabled: false }));

    const enabled = registry.getEnabled('before');
    expect(enabled.map(h => h.name)).toEqual(['high', 'mid', 'low']);
  });

  it('应注销 hook', () => {
    registry.register(makeHook('test'));
    expect(registry.unregister('test')).toBe(true);
    expect(registry.get('test')).toBeUndefined();
  });

  it('应设置启用/禁用', () => {
    registry.register(makeHook('test'));
    expect(registry.setEnabled('test', false)).toBe(true);
    expect(registry.getEnabled('before').length).toBe(0);
    expect(registry.setEnabled('test', true)).toBe(true);
    expect(registry.getEnabled('before').length).toBe(1);
  });

  it('应正确统计数量', () => {
    expect(registry.size).toBe(0);
    registry.register(makeHook('a'));
    registry.register(makeHook('b'));
    expect(registry.size).toBe(2);
  });
});

describe('HookPipeline', () => {
  let registry: HookRegistry<TestContext, unknown>;
  let pipeline: HookPipeline<TestContext>;

  beforeEach(() => {
    registry = new HookRegistry();
    pipeline = new HookPipeline(registry);
  });

  it('应执行所有 before hook', async () => {
    const ctx: TestContext = { value: '', calls: [] };
    registry.register(makeHook('h1'));
    registry.register(makeHook('h2'));

    const result = await pipeline.run('before', ctx);

    expect(result.passed).toBe(true);
    expect(ctx.calls).toEqual(['h1', 'h2']);
    expect(result.records.length).toBe(2);
  });

  it('blocking hook 失败应停止后续', async () => {
    const ctx: TestContext = { value: '', calls: [] };
    registry.register(makeHook('pass1'));
    registry.register(makeHook('block', {
      execute: async () => ({ passed: false, error: 'blocked' }),
      errorStrategy: 'block',
    }));
    registry.register(makeHook('never_runs'));

    const result = await pipeline.run('before', ctx);

    expect(result.passed).toBe(false);
    expect(result.blockedBy).toEqual(['block']);
    // block hook 的 execute 被覆盖，不 push calls
    expect(ctx.calls).toEqual(['pass1']);
    expect(ctx.calls).not.toContain('never_runs');
  });

  it('warn hook 失败应继续但记录警告', async () => {
    const ctx: TestContext = { value: '', calls: [] };
    registry.register(makeHook('warn_hook', {
      execute: async () => ({ passed: false, error: 'warning' }),
      errorStrategy: 'warn',
    }));
    registry.register(makeHook('should_still_run'));

    const result = await pipeline.run('before', ctx);

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual(['warn_hook']);
    expect(ctx.calls).toContain('should_still_run');
  });

  it('ignore hook 失败应静默继续', async () => {
    const ctx: TestContext = { value: '', calls: [] };
    registry.register(makeHook('ignore_hook', {
      execute: async () => ({ passed: false, error: 'ignored' }),
      errorStrategy: 'ignore',
    }));
    registry.register(makeHook('still_runs'));

    const result = await pipeline.run('before', ctx);

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(ctx.calls).toContain('still_runs');
  });

  it('hook 抛异常应被捕获', async () => {
    const ctx: TestContext = { value: '', calls: [] };
    registry.register(makeHook('throws', {
      execute: async () => { throw new Error('crash'); },
      errorStrategy: 'warn',
    }));
    registry.register(makeHook('after_crash', { priority: 200 }));

    const result = await pipeline.run('before', ctx);

    expect(result.records[0].error).toContain('crash');
    expect(ctx.calls).toContain('after_crash');
  });

  it('runFull 应在 before/after 之间执行操作', async () => {
    const ctx: TestContext = { value: '', calls: [] };
    registry.register(makeHook('before_hook'));

    const afterHook = makeHook('after_hook', { phase: 'after' });
    registry.register(afterHook);

    const { pipelineResult, operationResult } = await pipeline.runFull(ctx, async () => {
      ctx.calls.push('operation');
      return 'done';
    });

    expect(pipelineResult.passed).toBe(true);
    expect(operationResult).toBe('done');
    expect(ctx.calls).toEqual(['before_hook', 'operation', 'after_hook']);
  });

  it('before hook 失败不应执行操作', async () => {
    const ctx: TestContext = { value: '', calls: [] };
    registry.register(makeHook('block', {
      execute: async () => ({ passed: false }),
      errorStrategy: 'block',
    }));

    const { pipelineResult, operationResult } = await pipeline.runFull(ctx, async () => {
      ctx.calls.push('should_not_run');
      return 'nope';
    });

    expect(pipelineResult.passed).toBe(false);
    expect(operationResult).toBeUndefined();
    expect(ctx.calls).not.toContain('should_not_run');
  });

  it('空注册表应返回通过', async () => {
    const result = await pipeline.run('before', { value: '', calls: [] });
    expect(result.passed).toBe(true);
    expect(result.records).toEqual([]);
  });

  it('应忽略 disabled hook', async () => {
    const ctx: TestContext = { value: '', calls: [] };
    registry.register(makeHook('enabled'));
    registry.register(makeHook('disabled', { enabled: false }));

    const result = await pipeline.run('before', ctx);

    expect(ctx.calls).toEqual(['enabled']);
    expect(ctx.calls).not.toContain('disabled');
  });
});
