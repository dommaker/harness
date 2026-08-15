/**
 * HookRegistry — hook 注册/注销/查询
 *
 * 纯簿记，无执行逻辑。线程不安全（Node.js 单线程）。
 */

import type { HookConfig, HookDefinition, HookPhase } from './types';

/**
 * 注册表闭环双向校验（H5，复制 checker 闭环模式）
 *
 * 声明（HookConfig，consumer 的 per-hook 配置表）↔ 实现（注册的
 * HookDefinition）加载期双向校验，任一不满足即抛错，拒绝静默缺失：
 * - 引用未注册 → 抛错（声明了配置但没有注册实现 = 死配置）
 * - 注册无定义 → 抛错（注册了实现但没有配置声明 = 死代码）
 * - 重复声明 / 重复注册 → 抛错
 *
 * 断言限构建/测试期调用（harness 无内置 hook 定义，加载期闭环由
 * consumer 在其注册点/测试中调用本函数），不进入运行时热路径，
 * 不破坏 --help/--version 懒加载。消灭「hook 定义不注册 = 死代码」
 * 类 prompt 规矩（studio 侧随动）。
 *
 * @throws 任一方向不满足时抛错
 */
export function assertHookRegistryClosed<C = unknown, R = unknown>(
  configs: readonly HookConfig[],
  hooks: readonly HookDefinition<C, R>[]
): void {
  const configNames = new Set<string>();
  for (const config of configs) {
    if (configNames.has(config.name)) {
      throw new Error(
        `[harness] hook 注册表闭环校验失败：hook 配置 "${config.name}" 重复声明。`
      );
    }
    configNames.add(config.name);
  }

  const hookNames = new Set<string>();
  for (const hook of hooks) {
    if (hookNames.has(hook.name)) {
      throw new Error(
        `[harness] hook 注册表闭环校验失败：hook "${hook.name}" 重复注册。`
      );
    }
    hookNames.add(hook.name);
  }

  for (const config of configs) {
    if (!hookNames.has(config.name)) {
      throw new Error(
        `[harness] hook 注册表闭环校验失败：hook 配置 "${config.name}" 引用的实现未注册。` +
        `请注册同名 HookDefinition，或删除该配置声明。`
      );
    }
  }

  for (const hook of hooks) {
    if (!configNames.has(hook.name)) {
      throw new Error(
        `[harness] hook 注册表闭环校验失败：hook "${hook.name}" 注册了实现但没有对应配置声明。` +
        `请补齐 HookConfig 声明，或移除该实现。`
      );
    }
  }
}

export class HookRegistry<C = unknown, R = unknown> {
  private hooks: Map<string, HookDefinition<C, R>> = new Map();

  /**
   * 注册 hook（同名覆盖）
   */
  register(hook: HookDefinition<C, R>): void {
    this.hooks.set(hook.name, { ...hook });
  }

  /**
   * 批量注册
   */
  registerAll(hooks: HookDefinition<C, R>[]): void {
    for (const hook of hooks) {
      this.register(hook);
    }
  }

  /**
   * 注销 hook
   */
  unregister(name: string): boolean {
    return this.hooks.delete(name);
  }

  /**
   * 获取单个 hook
   */
  get(name: string): HookDefinition<C, R> | undefined {
    return this.hooks.get(name);
  }

  /**
   * 获取指定时机、已启用的 hook，按优先级排序
   */
  getEnabled(phase: HookPhase): HookDefinition<C, R>[] {
    return Array.from(this.hooks.values())
      .filter(h => h.phase === phase && h.enabled !== false)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /**
   * 列出所有 hook 名称
   */
  listNames(): string[] {
    return Array.from(this.hooks.keys());
  }

  /**
   * 列出所有 hook（含禁用）
   */
  listAll(): HookDefinition<C, R>[] {
    return Array.from(this.hooks.values());
  }

  /**
   * 启用/禁用 hook
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const hook = this.hooks.get(name);
    if (!hook) return false;
    hook.enabled = enabled;
    return true;
  }

  /**
   * 清空所有 hook
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Hook 数量
   */
  get size(): number {
    return this.hooks.size;
  }
}
