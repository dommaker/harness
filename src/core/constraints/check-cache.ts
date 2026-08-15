/**
 * CheckCache — 约束检查缓存（S7）
 *
 * 缓存 git diff 和 src/ 递归扫描结果，减少重复 I/O。
 * 同一请求内多次 checkConstraints 调用共享缓存。
 *
 * 计数采样（H6/G5，收编 studio runtime/cache.ts）：
 * get/getSync 可传声明式采样配置，对每个 (namespace, key) 独立计数，
 * 第 1 次调用必执行，此后每 N 次执行 1 次完整检查，其余 N-1 次复用缓存；
 * 非采样轮缓存未命中（无缓存或已过期）时返回 defaultValueOnMiss，不执行 fn。
 * invalidate 同时重置对应计数，保证失效后下一次调用恢复为完整检查。
 *
 * 用法：
 * ```typescript
 * const cache = new CheckCache({ ttlMs: 5000 });
 * // 普通 TTL 缓存
 * const diff = await cache.get('git_diff', projectPath, () => runCommand('git diff --cached', projectPath));
 * // 计数采样：每 3 次调用执行 1 次完整检查
 * const ok = await cache.get('goal_check', key, check, { sampleRate: 3, defaultValueOnMiss: true });
 * ```
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * CheckCache 构造配置
 */
export interface CheckCacheConfig {
  /** 缓存 TTL（毫秒），默认 5000 */
  ttlMs: number;
}

/**
 * 计数采样配置（声明式）
 *
 * 传此配置后，对应 (namespace, key) 启用计数采样：
 * - 第 1 次调用必执行 fn（采样轮），结果以正常 TTL 写入缓存；
 * - 其后每 N 次调用执行 1 次（计数独立于普通缓存读写）；
 * - 非采样轮：缓存命中（未过期）返回缓存值；未命中或已过期
 *   返回 {@link defaultValueOnMiss}，不执行 fn、不刷新 TTL。
 */
export interface CheckSamplingConfig<T> {
  /** 采样率：每 N 次调用执行 1 次完整检查；N <= 1 视为不采样（回退为普通 TTL 缓存语义） */
  sampleRate: number;
  /** 非采样轮且缓存未命中（无缓存或已过期）时的默认返回值 */
  defaultValueOnMiss: T;
}

/**
 * 约束检查缓存：TTL 缓存 + 可选计数采样
 *
 * 普通 get/getSync 为 TTL 缓存；传入 sampling 配置后对应 (namespace, key)
 * 启用计数采样（每 N 次执行 1 次完整检查，其余轮次复用缓存或返回
 * defaultValueOnMiss）。语义详见 {@link CheckSamplingConfig}。
 */
export class CheckCache {
  private store = new Map<string, CacheEntry>();
  /** 采样计数器（仅启用采样的 key 有计数） */
  private sampleCounters = new Map<string, number>();
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
   * @param sampling 计数采样配置（可选；不传时每次 miss 都执行 fn）
   */
  async get<T>(
    namespace: string,
    key: string,
    fn: () => Promise<T>,
    sampling?: CheckSamplingConfig<T>,
  ): Promise<T> {
    const cacheKey = `${namespace}:${key}`;
    const entry = this.store.get(cacheKey);
    const rate = sampling ? Math.max(1, Math.floor(sampling.sampleRate)) : 1;
    // 采样轮优先于缓存命中：每 N 次调用必执行一次完整检查（第 1 次必执行）
    const sampleTurn = rate > 1 && this.isSampleTurn(cacheKey, rate);

    if (!sampleTurn && entry && Date.now() < entry.expiresAt) {
      return entry.value as T;
    }

    if (sampling && rate > 1 && !sampleTurn) {
      return sampling.defaultValueOnMiss;
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
   *
   * @param sampling 计数采样配置（语义同 {@link get}）
   */
  getSync<T>(
    namespace: string,
    key: string,
    fn: () => T,
    sampling?: CheckSamplingConfig<T>,
  ): T {
    const cacheKey = `${namespace}:${key}`;
    const entry = this.store.get(cacheKey);
    const rate = sampling ? Math.max(1, Math.floor(sampling.sampleRate)) : 1;
    const sampleTurn = rate > 1 && this.isSampleTurn(cacheKey, rate);

    if (!sampleTurn && entry && Date.now() < entry.expiresAt) {
      return entry.value as T;
    }

    if (sampling && rate > 1 && !sampleTurn) {
      return sampling.defaultValueOnMiss;
    }

    const value = fn();
    this.store.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return value;
  }

  /**
   * 使指定命名空间缓存失效（同时重置该命名空间的采样计数器，
   * 保证失效后的下一次调用恢复为采样轮/完整检查）
   */
  invalidate(namespace?: string): void {
    if (namespace) {
      for (const key of this.store.keys()) {
        if (key.startsWith(`${namespace}:`)) {
          this.store.delete(key);
        }
      }
      for (const key of this.sampleCounters.keys()) {
        if (key.startsWith(`${namespace}:`)) {
          this.sampleCounters.delete(key);
        }
      }
    } else {
      this.store.clear();
      this.sampleCounters.clear();
    }
  }

  /**
   * 计数采样判定：计数 +1 后返回是否采样轮（第 1 次必采样，每 N 次 1 次）。
   * 仅在采样启用（rate > 1）时调用。
   */
  private isSampleTurn(cacheKey: string, rate: number): boolean {
    const count = (this.sampleCounters.get(cacheKey) ?? 0) + 1;
    this.sampleCounters.set(cacheKey, count);
    return count % rate === 1;
  }
}
