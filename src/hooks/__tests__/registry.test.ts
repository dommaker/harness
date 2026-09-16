/**
 * Hook 注册表闭环双向校验测试（H5，复制 checker 闭环模式）
 *
 * 两个失败方向 + 重复声明/注册都必须抛错；闭环通过时不抛错。
 *
 * #159 起注册即配对：`register(hook, config)` 以 HookConfig 填充有效
 * `enabled` / `errorStrategy`——配置表是这两个语义的唯一声明点，
 * HookDefinition 类型上不再存在同名字段（矛盾在构造上不可能出现）。
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

function makeConfig(name: string, overrides: Partial<HookConfig> = {}): HookConfig {
  return { name, enabled: true, errorStrategy: 'block', ...overrides };
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
    registry.registerAll([makeHook('beforeAgentExecute')], [makeConfig('beforeAgentExecute')]);
    expect(() => assertHookRegistryClosed([makeConfig('beforeAgentExecute')], registry.listAll()))
      .not.toThrow();
  });
});

describe('HookRegistry 注册即配对（#159 配置表唯一化）', () => {
  it('register 以 HookConfig 填充有效 enabled / errorStrategy', () => {
    const registry = new HookRegistry();
    registry.register(makeHook('a'), makeConfig('a', { enabled: false, errorStrategy: 'block' }));

    const effective = registry.get('a');
    expect(effective?.enabled).toBe(false);
    expect(effective?.errorStrategy).toBe('block');
    // 配置 enabled:false → 不进 enabled 列表
    expect(registry.getEnabled('before')).toEqual([]);
  });

  it('register 定义与配置名称不一致 → 抛错', () => {
    const registry = new HookRegistry();
    expect(() => registry.register(makeHook('a'), makeConfig('b'))).toThrow(/名称不一致/);
  });

  it('registerAll 有实现缺配置声明 → 抛错', () => {
    const registry = new HookRegistry();
    expect(() =>
      registry.registerAll([makeHook('a'), makeHook('orphan')], [makeConfig('a')])
    ).toThrow(/hook "orphan" 没有对应的 HookConfig 声明/);
  });

  it('HookDefinition 类型上不再存在 enabled / errorStrategy（编译期钉）', () => {
    const withStrategy: HookDefinition = {
      name: 'x',
      phase: 'before',
      // @ts-expect-error HookDefinition 不再存在 errorStrategy 字段（#159）
      errorStrategy: 'block',
      execute: async () => ({ passed: true }),
    };
    const withEnabled: HookDefinition = {
      name: 'y',
      phase: 'before',
      // @ts-expect-error HookDefinition 不再存在 enabled 字段（#159）
      enabled: false,
      execute: async () => ({ passed: true }),
    };
    expect(withStrategy.name).toBe('x');
    expect(withEnabled.name).toBe('y');
  });
});
