/**
 * HookRegistry — hook 注册/注销/查询
 *
 * 纯簿记，无执行逻辑。线程不安全（Node.js 单线程）。
 */

import type { HookDefinition, HookPhase } from './types';

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
