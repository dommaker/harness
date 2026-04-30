import { delay } from '../utils/exec';

/**
 * @spec HZ-002
 * @implements HZ-002-C1
 * @acceptance AC-001-1, AC-001-4
 * 
 * Progressive Content Loader
 * 
 * 通用内容分片加载能力
 * - 支持大数据集分片加载
 * - 支持 Token 预算管理
 * - 零业务逻辑，可被任意系统使用
 */

export interface ChunkLoadOptions<T = any> {
  /** 每片大小 */
  chunkSize: number;
  /** 每片加载回调 */
  onChunk?: (chunk: T[], index: number) => Promise<void> | void;
  /** 进度回调 (loaded, total) */
  onProgress?: (loaded: number, total: number) => void;
  /** 是否并行加载 */
  parallel?: boolean;
  /** 延迟（毫秒），用于节流 */
  delay?: number;
}

export interface TokenBudgetOptions<T = any> {
  /** Token 预算 */
  budget: number;
  /** Token 估算函数 */
  estimator: (item: T) => number;
  /** 预算超限策略 */
  onBudgetExceeded?: 'truncate' | 'error' | 'skip';
  /** 最小保留项数（即使超预算） */
  minItems?: number;
}

export interface LoadResult<T> {
  /** 加载的项 */
  items: T[];
  /** 实际消耗的 Token */
  tokensUsed: number;
  /** 是否被截断 */
  truncated: boolean;
  /** 跳过的项数 */
  skipped: number;
}

/**
 * 渐进式内容加载器
 * 
 * 提供通用的内容分片加载和 Token 预算管理能力
 */
export class ProgressiveLoader {
  /**
   * 分片加载
   * 
   * 将大数据集分片加载，避免一次性加载全部内容
   * 
   * @example
   * ```typescript
   * const loader = new ProgressiveLoader();
   * const largeData = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
   * 
   * await loader.loadInChunks(largeData, {
   *   chunkSize: 100,
   *   onChunk: async (chunk, index) => {
   *     console.log(`Loaded chunk ${index}: ${chunk.length} items`);
   *   },
   *   onProgress: (loaded, total) => {
   *     console.log(`Progress: ${loaded}/${total}`);
   *   }
   * });
   * ```
   */
  async loadInChunks<T>(
    items: T[],
    options: ChunkLoadOptions<T>
  ): Promise<void> {
    const { chunkSize, onChunk, onProgress, parallel = false, delay: throttleDelay = 0 } = options;
    const total = items.length;
    const chunks: T[][] = [];

    // 分片
    for (let i = 0; i < total; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }

    // 加载
    if (parallel) {
      // 并行加载
      await Promise.all(
        chunks.map(async (chunk, index) => {
          if (throttleDelay > 0) {
            await delay(throttleDelay * index);
          }
          await this.processChunk(chunk, index, onChunk, onProgress, total);
        })
      );
    } else {
      // 串行加载
      for (let i = 0; i < chunks.length; i++) {
        if (throttleDelay > 0 && i > 0) {
          await delay(throttleDelay);
        }
        await this.processChunk(chunks[i], i, onChunk, onProgress, total);
      }
    }
  }

  /**
   * Token 预算加载
   * 
   * 在 Token 预算范围内加载内容，超预算时按策略处理
   * 
   * @example
   * ```typescript
   * const loader = new ProgressiveLoader();
   * const items = [
   *   { content: 'short text' },
   *   { content: 'long text '.repeat(100) }
   * ];
   * 
   * const result = await loader.loadWithBudget(items, {
   *   budget: 1000,
   *   estimator: (item) => item.content.length,
   *   onBudgetExceeded: 'truncate'
   * });
   * 
   * console.log(`Loaded ${result.items.length} items, used ${result.tokensUsed} tokens`);
   * ```
   */
  async loadWithBudget<T>(
    items: T[],
    options: TokenBudgetOptions<T>
  ): Promise<LoadResult<T>> {
    const {
      budget,
      estimator,
      onBudgetExceeded = 'truncate',
      minItems = 1
    } = options;

    const result: LoadResult<T> = {
      items: [],
      tokensUsed: 0,
      truncated: false,
      skipped: 0
    };

    let currentBudget = budget;

    for (const item of items) {
      const itemTokens = estimator(item);

      // 检查预算
      if (itemTokens > currentBudget) {
        // 预算超限
        if (result.items.length >= minItems) {
          // 已达到最小项数，按策略处理
          switch (onBudgetExceeded) {
            case 'truncate':
              result.truncated = true;
              return result;
            case 'error':
              throw new Error(
                `Token budget exceeded: need ${itemTokens}, remaining ${currentBudget}`
              );
            case 'skip':
              result.skipped++;
              continue;
          }
        }
        // 未达到最小项数，强制添加（可能超预算）
      }

      // 添加项
      result.items.push(item);
      result.tokensUsed += itemTokens;
      currentBudget -= itemTokens;
    }

    return result;
  }

  /**
   * 创建流式加载器
   * 
   * 支持大文件/大内容的流式分片加载
   */
  async *createStream<T>(
    source: AsyncIterable<T>,
    chunkSize: number
  ): AsyncIterable<T[]> {
    let chunk: T[] = [];

    for await (const item of source) {
      chunk.push(item);

      if (chunk.length >= chunkSize) {
        yield chunk;
        chunk = [];
      }
    }

    //  yield remaining items
    if (chunk.length > 0) {
      yield chunk;
    }
  }

  /**
   * 批量处理（带并发控制）
   */
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrency: number = 5
  ): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];

    for (const item of items) {
      const promise = processor(item).then(result => {
        results.push(result);
      });

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        executing.splice(
          executing.findIndex(p => p === promise),
          1
        );
      }
    }

    await Promise.all(executing);
    return results;
  }

  private async processChunk<T>(
    chunk: T[],
    index: number,
    onChunk: ((chunk: T[], index: number) => Promise<void> | void) | undefined,
    onProgress: ((loaded: number, total: number) => void) | undefined,
    total: number
  ): Promise<void> {
    if (onChunk) {
      await onChunk(chunk, index);
    }

    if (onProgress) {
      const loaded = Math.min((index + 1) * chunk.length, total);
      onProgress(loaded, total);
    }
  }

}

// 默认实例
export const progressiveLoader = new ProgressiveLoader();
