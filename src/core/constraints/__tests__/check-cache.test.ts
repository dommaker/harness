/**
 * CheckCache 测试（H6/G5：TTL 缓存既有行为 + 计数采样扩展）
 *
 * 计数采样语义（与 studio runtime/cache.ts 收编对齐）：
 * - 每个 (namespace, key) 独立计数
 * - 第 1 次调用必执行（采样轮），此后每 N 次执行 1 次
 * - 非采样轮：缓存命中（未过期）返回缓存值；未命中/已过期返回 defaultValueOnMiss，不执行 fn
 */

import { CheckCache } from '../check-cache';
import { CheckCache as PublicCheckCache } from '../../../index';

describe('公开导出（根 barrel）', () => {
  test('CheckCache 经 src/index.ts 公开导出', () => {
    expect(PublicCheckCache).toBe(CheckCache);
  });
});

describe('CheckCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('TTL 缓存（既有行为，不传 sampling 参数）', () => {
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

  describe('计数采样（声明式配置）', () => {
    test('第 1 次调用必执行，此后每 N 次执行 1 次，其余复用缓存结果', async () => {
      const cache = new CheckCache({ ttlMs: 60_000 });
      let runs = 0;
      const fn = jest.fn(async () => `run-${++runs}`);
      const sampling = { sampleRate: 3, defaultValueOnMiss: 'skip' };

      // 第 1 次：采样轮 → 执行
      expect(await cache.get('ns', 'k', fn, sampling)).toBe('run-1');
      // 第 2、3 次：非采样轮 → 复用缓存
      expect(await cache.get('ns', 'k', fn, sampling)).toBe('run-1');
      expect(await cache.get('ns', 'k', fn, sampling)).toBe('run-1');
      expect(fn).toHaveBeenCalledTimes(1);
      // 第 4 次：采样轮 → 执行
      expect(await cache.get('ns', 'k', fn, sampling)).toBe('run-2');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('非采样轮缓存已过期：返回 defaultValueOnMiss，不执行 fn', async () => {
      const cache = new CheckCache({ ttlMs: 1000 });
      const fn = jest.fn(async () => 'fresh');
      const sampling = { sampleRate: 3, defaultValueOnMiss: 'skip' };

      expect(await cache.get('ns', 'k', fn, sampling)).toBe('fresh'); // 采样轮，TTL=1s 缓存
      jest.advanceTimersByTime(1001);

      expect(await cache.get('ns', 'k', fn, sampling)).toBe('skip'); // 过期 + 非采样轮
      expect(await cache.get('ns', 'k', fn, sampling)).toBe('skip');
      expect(fn).toHaveBeenCalledTimes(1);

      // 第 4 次：采样轮 → 重新执行
      expect(await cache.get('ns', 'k', fn, sampling)).toBe('fresh');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('采样计数器按 key 独立', async () => {
      const cache = new CheckCache({ ttlMs: 60_000 });
      const f1 = jest.fn(async () => 'a');
      const f2 = jest.fn(async () => 'b');
      const sampling = { sampleRate: 3, defaultValueOnMiss: 'x' };

      await cache.get('ns', 'k1', f1, sampling);
      await cache.get('ns', 'k2', f2, sampling);
      expect(f1).toHaveBeenCalledTimes(1);
      expect(f2).toHaveBeenCalledTimes(1);

      await cache.get('ns', 'k1', f1, sampling); // k1 非采样轮
      expect(f1).toHaveBeenCalledTimes(1);
    });

    test('invalidate 重置计数器：失效后下一次调用恢复为采样轮', async () => {
      const cache = new CheckCache({ ttlMs: 60_000 });
      const fn = jest.fn(async () => 'v');
      const sampling = { sampleRate: 3, defaultValueOnMiss: 'd' };

      await cache.get('ns', 'k', fn, sampling); // count=1 采样
      await cache.get('ns', 'k', fn, sampling); // count=2 跳过
      cache.invalidate('ns');
      await cache.get('ns', 'k', fn, sampling); // 重置后 count=1 采样
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('invalidate() 全量同样重置计数器', async () => {
      const cache = new CheckCache({ ttlMs: 60_000 });
      const fn = jest.fn(async () => 'v');
      const sampling = { sampleRate: 2, defaultValueOnMiss: 'd' };

      await cache.get('ns', 'k', fn, sampling); // count=1 采样
      cache.invalidate();
      await cache.get('ns', 'k', fn, sampling); // 重置后 count=1 采样
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('sampleRate <= 1 视为不采样：回退为普通 TTL 缓存语义', async () => {
      const cache = new CheckCache({ ttlMs: 60_000 });
      const fn = jest.fn(async () => 'v');

      await cache.get('ns', 'k', fn, { sampleRate: 1, defaultValueOnMiss: 'd' });
      await cache.get('ns', 'k', fn, { sampleRate: 0, defaultValueOnMiss: 'd' });
      expect(fn).toHaveBeenCalledTimes(1); // TTL 命中，无采样短路
    });

    test('getSync 同样支持计数采样', () => {
      const cache = new CheckCache({ ttlMs: 60_000 });
      const fn = jest.fn(() => 'sync');
      const sampling = { sampleRate: 3, defaultValueOnMiss: 'skip' };

      expect(cache.getSync('ns', 'k', fn, sampling)).toBe('sync'); // 采样轮
      expect(cache.getSync('ns', 'k', fn, sampling)).toBe('sync'); // 复用缓存
      expect(cache.getSync('ns', 'k', fn, sampling)).toBe('sync'); // 复用缓存
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('getSync 非采样轮缓存过期返回默认值', () => {
      const cache = new CheckCache({ ttlMs: 1000 });
      const fn = jest.fn(() => 'sync');
      const sampling = { sampleRate: 3, defaultValueOnMiss: 'skip' };

      expect(cache.getSync('ns', 'k', fn, sampling)).toBe('sync'); // 采样轮 @t0
      jest.advanceTimersByTime(1001);
      expect(cache.getSync('ns', 'k', fn, sampling)).toBe('skip'); // 过期 + 非采样轮
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('采样轮执行结果以正常 TTL 写入缓存，非采样轮不刷新 TTL', async () => {
      const cache = new CheckCache({ ttlMs: 1000 });
      const fn = jest.fn(async () => 'v');
      const sampling = { sampleRate: 3, defaultValueOnMiss: 'd' };

      await cache.get('ns', 'k', fn, sampling); // 采样轮 @t0
      jest.advanceTimersByTime(500);
      await cache.get('ns', 'k', fn, sampling); // 非采样轮 @t0+500（不应刷新过期时间）
      jest.advanceTimersByTime(600); // t0+1100：若 TTL 被刷新则仍命中
      expect(await cache.get('ns', 'k', fn, sampling)).toBe('d'); // 已过期 → 默认值
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
