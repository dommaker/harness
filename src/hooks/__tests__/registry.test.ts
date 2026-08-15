/**
 * Hook 注册表闭环双向校验测试（H5，复制 checker 闭环模式）
 *
 * 两个失败方向 + 重复声明/注册都必须抛错；闭环通过时不抛错。
 */

import { assertHookRegistryClosed, HookRegistry } from '../registry';
import type { HookConfig, HookDefinition } from '../types';

function makeHook(name: string): HookDefinition {
  return {
    name,
    phase: 'before',
    execute: async () => ({ passed: true }),
  };
}

function makeConfig(name: string): HookConfig {
  return { name, enabled: true, errorStrategy: 'block' };
}

describe('assertHookRegistryClosed', () => {
  it('声明与注册一一对应时通过', () => {
    const configs = [makeConfig('beforeAgentExecute'), makeConfig('afterReview')];
    const hooks = [makeHook('beforeAgentExecute'), makeHook('afterReview')];
    expect(() => assertHookRegistryClosed(configs, hooks)).not.toThrow();
  });

  it('空声明 + 空注册通过（无 hook 的 consumer 合法）', () => {
    expect(() => assertHookRegistryClosed([], [])).not.toThrow();
  });

  it('引用未注册 → 抛错：声明了配置但没有注册实现', () => {
    const configs = [makeConfig('beforeAgentExecute'), makeConfig('ghostHook')];
    const hooks = [makeHook('beforeAgentExecute')];
    expect(() => assertHookRegistryClosed(configs, hooks)).toThrow(
      /hook 配置 "ghostHook" 引用的实现未注册/
    );
  });

  it('注册无定义 → 抛错：注册了实现但没有配置声明', () => {
    const configs = [makeConfig('beforeAgentExecute')];
    const hooks = [makeHook('beforeAgentExecute'), makeHook('orphanHook')];
    expect(() => assertHookRegistryClosed(configs, hooks)).toThrow(
      /hook "orphanHook" 注册了实现但没有对应配置声明/
    );
  });

  it('重复声明 → 抛错', () => {
    const configs = [makeConfig('dup'), makeConfig('dup')];
    const hooks = [makeHook('dup')];
    expect(() => assertHookRegistryClosed(configs, hooks)).toThrow(/重复声明/);
  });

  it('重复注册 → 抛错', () => {
    const configs = [makeConfig('dup')];
    const hooks = [makeHook('dup'), makeHook('dup')];
    expect(() => assertHookRegistryClosed(configs, hooks)).toThrow(/重复注册/);
  });

  it('与 HookRegistry.listAll 组合可用（consumer 注册点用法）', () => {
    const registry = new HookRegistry();
    registry.registerAll([makeHook('beforeAgentExecute')]);
    expect(() => assertHookRegistryClosed([makeConfig('beforeAgentExecute')], registry.listAll()))
      .not.toThrow();
  });
});
