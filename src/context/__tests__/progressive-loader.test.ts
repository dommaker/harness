/**
 * ProgressiveLoader 测试
 */

import { ProgressiveLoader, progressiveLoader } from '../progressive-loader';

describe('ProgressiveLoader', () => {
  let loader: ProgressiveLoader;

  beforeEach(() => {
    loader = new ProgressiveLoader();
  });

  describe('loadInChunks()', () => {
    it('should load items in chunks', async () => {
      const items = Array.from({ length: 100 }, (_, i) => i);
      const chunks: any[] = [];

      await loader.loadInChunks(items, {
        chunkSize: 20,
        onChunk: (chunk, index) => { chunks.push(chunk); },
      });

      expect(chunks.length).toBe(5);
      expect(chunks[0].length).toBe(20);
    });

    it('should call progress callback', async () => {
      const items = Array.from({ length: 50 }, (_, i) => i);
      const progress: any[] = [];

      await loader.loadInChunks(items, {
        chunkSize: 10,
        onProgress: (loaded, total) => progress.push({ loaded, total }),
      });

      expect(progress.length).toBeGreaterThan(0);
      expect(progress[progress.length - 1].loaded).toBe(50);
    });

    it('should load in parallel when parallel=true', async () => {
      const items = Array.from({ length: 20 }, (_, i) => i);
      const chunks: any[] = [];

      await loader.loadInChunks(items, {
        chunkSize: 5,
        parallel: true,
        onChunk: (chunk, index) => { chunks.push(chunk); },
      });

      expect(chunks.length).toBe(4);
    });

    it('should handle delay', async () => {
      const items = Array.from({ length: 10 }, (_, i) => i);

      const start = Date.now();
      await loader.loadInChunks(items, {
        chunkSize: 2,
        delay: 10,
      });

      // Should have taken some time (at least 4 delays = 40ms)
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(30);
    });

    it('should handle empty items', async () => {
      await loader.loadInChunks([], {
        chunkSize: 10,
      });
      // Should complete without error
    });

    it('should handle items not divisible by chunkSize', async () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const chunks: any[] = [];

      await loader.loadInChunks(items, {
        chunkSize: 10,
        onChunk: (chunk, index) => { chunks.push(chunk); },
      });

      expect(chunks.length).toBe(3);
      expect(chunks[2].length).toBe(5);
    });
  });

  describe('loadWithBudget()', () => {
    it('should load items within budget', async () => {
      const items = [
        { text: 'short' },
        { text: 'medium' },
        { text: 'long' },
      ];

      const result = await loader.loadWithBudget(items, {
        budget: 100,
        estimator: (item) => item.text.length,
      });

      expect(result.items.length).toBe(3);
      expect(result.tokensUsed).toBe(15);
      expect(result.truncated).toBe(false);
    });

    it('should truncate when budget exceeded', async () => {
      const items = [
        { text: 'a' },
        { text: 'b'.repeat(100) },
        { text: 'c'.repeat(100) },
      ];

      const result = await loader.loadWithBudget(items, {
        budget: 50,
        estimator: (item) => item.text.length,
        onBudgetExceeded: 'truncate',
      });

      expect(result.items.length).toBeLessThan(3);
      expect(result.truncated).toBe(true);
    });

    it('should throw error when onBudgetExceeded=error', async () => {
      const items = [
        { text: 'short' },
        { text: 'a'.repeat(200) },
      ];

      await expect(
        loader.loadWithBudget(items, {
          budget: 50,
          estimator: (item) => item.text.length,
          onBudgetExceeded: 'error',
        })
      ).rejects.toThrow('Token budget exceeded');
    });

    it('should skip items when onBudgetExceeded=skip', async () => {
      const items = [
        { text: 'short' },
        { text: 'verylong'.repeat(100) },
        { text: 'short2' },
      ];

      const result = await loader.loadWithBudget(items, {
        budget: 50,
        estimator: (item) => item.text.length,
        onBudgetExceeded: 'skip',
      });

      expect(result.skipped).toBeGreaterThan(0);
    });

    it('should respect minItems', async () => {
      const items = [
        { text: 'verylong'.repeat(100) },
        { text: 'verylong'.repeat(100) },
      ];

      const result = await loader.loadWithBudget(items, {
        budget: 10,
        estimator: (item) => item.text.length,
        minItems: 1,
        onBudgetExceeded: 'truncate',
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty items', async () => {
      const result = await loader.loadWithBudget([], {
        budget: 100,
        estimator: (item) => 0,
      });

      expect(result.items.length).toBe(0);
      expect(result.tokensUsed).toBe(0);
    });
  });

  describe('createStream()', () => {
    it('should create async iterator', async () => {
      const source = async function* () {
        yield 1;
        yield 2;
        yield 3;
        yield 4;
        yield 5;
      };

      const stream = loader.createStream(source(), 2);
      const chunks: any[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(3);
      expect(chunks[0]).toEqual([1, 2]);
      expect(chunks[2]).toEqual([5]);
    });

    it('should handle empty source', async () => {
      const source = async function* () {};

      const stream = loader.createStream(source(), 10);
      const chunks: any[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(0);
    });
  });

  describe('processBatch()', () => {
    it('should process items with concurrency', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = async (n: number) => n * 2;

      const results = await loader.processBatch(items, processor, 2);

      expect(results.length).toBe(5);
      expect(results).toContain(2);
      expect(results).toContain(10);
    });

    it('should handle empty items', async () => {
      const results = await loader.processBatch([], async (n) => n, 5);
      expect(results.length).toBe(0);
    });

    it('should handle async processor', async () => {
      const items = [1, 2, 3];
      const processed: number[] = [];

      const processor = async (n: number) => {
        processed.push(n);
        return n * 2;
      };

      const results = await loader.processBatch(items, processor, 1);

      // Check that all items were processed
      expect(processed.sort()).toEqual([1, 2, 3]);
    });
  });
});

describe('progressiveLoader (default instance)', () => {
  it('should be usable', async () => {
    const items = [1, 2, 3];
    const chunks: any[] = [];

    await progressiveLoader.loadInChunks(items, {
      chunkSize: 1,
      onChunk: (chunk, index) => { chunks.push(chunk); return undefined; },
    });

    expect(chunks.length).toBe(3);
  });
});