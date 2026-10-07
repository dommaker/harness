/**
 * CheckCache 测试（S7：TTL 缓存行为）
 */

import { CheckCache } from '../check-cache';

describe('CheckCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('TTL 缓存', () => {
    test('缓存命中不重复执行 fn，过期后重新执行', async () => {
      const cache = new CheckCache({ ttlMs: 1000 });
      const fn = jest.fn(async () => 'v1');

      expect(await cache.get('ns', 'k', fn)).toBe('v1');
      expect(await cache.get('ns', 'k', fn)).toBe('v1');
      expect(fn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1001);
      expect(await cache.get('ns', 'k', fn)).toBe('v1');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('getSync 命中/过期行为一致', () => {
      const cache = new CheckCache({ ttlMs: 1000 });
      const fn = jest.fn(() => 'sync');

      expect(cache.getSync('ns', 'k', fn)).toBe('sync');
      expect(cache.getSync('ns', 'k', fn)).toBe('sync');
      expect(fn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1001);
      expect(cache.getSync('ns', 'k', fn)).toBe('sync');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('缺省构造使用默认 TTL 5000ms', async () => {
      const cache = new CheckCache();
      const fn = jest.fn(async () => 'v');

      await cache.get('ns', 'k', fn);
      jest.advanceTimersByTime(4999);
      await cache.get('ns', 'k', fn);
      expect(fn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2); // 累计 5001ms，已过期
      await cache.get('ns', 'k', fn);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('命名空间隔离：不同 namespace 相同 key 互不影响', async () => {
      const cache = new CheckCache({ ttlMs: 1000 });
      const f1 = jest.fn(async () => 'a');
      const f2 = jest.fn(async () => 'b');

      expect(await cache.get('ns1', 'k', f1)).toBe('a');
      expect(await cache.get('ns2', 'k', f2)).toBe('b');
      expect(f1).toHaveBeenCalledTimes(1);
      expect(f2).toHaveBeenCalledTimes(1);
    });

    test('invalidate(namespace) 仅清除指定命名空间', async () => {
      const cache = new CheckCache({ ttlMs: 1000 });
      const f1 = jest.fn(async () => 'a');
      const f2 = jest.fn(async () => 'b');

      await cache.get('ns1', 'k', f1);
      await cache.get('ns2', 'k', f2);
      cache.invalidate('ns1');

      expect(await cache.get('ns1', 'k', f1)).toBe('a');
      expect(await cache.get('ns2', 'k', f2)).toBe('b');
      expect(f1).toHaveBeenCalledTimes(2);
      expect(f2).toHaveBeenCalledTimes(1);
    });

    test('invalidate() 清除全部缓存', async () => {
      const cache = new CheckCache({ ttlMs: 1000 });
      const fn = jest.fn(async () => 'v');

      await cache.get('ns', 'k1', fn);
      await cache.get('ns', 'k2', fn);
      cache.invalidate();

      await cache.get('ns', 'k1', fn);
      await cache.get('ns', 'k2', fn);
      expect(fn).toHaveBeenCalledTimes(4);
    });
  });

});
