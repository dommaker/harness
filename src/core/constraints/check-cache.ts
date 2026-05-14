/**
 * CheckCache — 约束检查缓存（S7）
 *
 * 缓存 git diff 和 src/ 递归扫描结果，减少重复 I/O。
 * 同一请求内多次 checkConstraints 调用共享缓存。
 *
 * 用法：
 * ```typescript
 * const cache = new CheckCache({ ttlMs: 5000 });
 * const diff = await cache.get('git_diff', projectPath, () => runCommand('git diff --cached', projectPath));
 * ```
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export interface CheckCacheConfig {
  /** 缓存 TTL（毫秒），默认 5000 */
  ttlMs: number;
}

export class CheckCache {
  private store = new Map<string, CacheEntry>();
  private ttlMs: number;

  constructor(config?: CheckCacheConfig) {
    this.ttlMs = config?.ttlMs ?? 5000;
  }

  /**
   * 获取缓存值（miss 时执行 fn 并缓存结果）
   *
   * @param namespace 命名空间（如 'git_diff', 'src_scan'）
   * @param key 缓存键（如 projectPath）
   * @param fn miss 时的计算函数
   */
  async get<T>(
    namespace: string,
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const cacheKey = `${namespace}:${key}`;
    const entry = this.store.get(cacheKey);

    if (entry && Date.now() < entry.expiresAt) {
      return entry.value as T;
    }

    const value = await fn();
    this.store.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return value;
  }

  /**
   * 同步版本（用于 readdirSync 等同步操作）
   */
  getSync<T>(
    namespace: string,
    key: string,
    fn: () => T,
  ): T {
    const cacheKey = `${namespace}:${key}`;
    const entry = this.store.get(cacheKey);

    if (entry && Date.now() < entry.expiresAt) {
      return entry.value as T;
    }

    const value = fn();
    this.store.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return value;
  }

  /**
   * 使指定命名空间缓存失效
   */
  invalidate(namespace?: string): void {
    if (namespace) {
      for (const key of this.store.keys()) {
        if (key.startsWith(`${namespace}:`)) {
          this.store.delete(key);
        }
      }
    } else {
      this.store.clear();
    }
  }
}
