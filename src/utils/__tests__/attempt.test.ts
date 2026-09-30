/**
 * attempt 测试（吞错治理，Phase 2）
 *
 * 契约：正常路径透传返回值；异常路径调 onError 拿降级值，err 原样交给 onError；
 * onError 自己再抛时不拦（降级逻辑本身的 bug 不二次吞掉）。
 */

import { attempt, attemptAsync } from '../attempt';

describe('attempt（同步）', () => {
  it('fn 正常返回 → 透传返回值，onError 不被调用', () => {
    const onError = jest.fn(() => -1);
    expect(attempt(() => 42, onError)).toBe(42);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fn 抛错 → 返回 onError 的降级值，err 原样传入', () => {
    const boom = new Error('boom');
    const onError = jest.fn(() => 'fallback');
    expect(
      attempt(() => {
        throw boom;
      }, onError),
    ).toBe('fallback');
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('非 Error 抛出物同样原样交给 onError', () => {
    expect(
      attempt(
        () => {
          throw 'raw-string';
        },
        (err) => `caught:${String(err)}`,
      ),
    ).toBe('caught:raw-string');
  });

  it('onError 再抛 → 不二次吞，原样抛出', () => {
    const second = new Error('fallback-broken');
    expect(() =>
      attempt(
        () => {
          throw new Error('first');
        },
        () => {
          throw second;
        },
      ),
    ).toThrow(second);
  });
});

describe('attemptAsync（异步）', () => {
  it('fn 正常 resolve → 透传', async () => {
    await expect(attemptAsync(async () => 7, () => 0)).resolves.toBe(7);
  });

  it('fn reject → 返回 onError 降级值，err 原样传入', async () => {
    const boom = new Error('async-boom');
    const onError = jest.fn(() => -1);
    await expect(
      attemptAsync(async () => {
        throw boom;
      }, onError),
    ).resolves.toBe(-1);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('onError 返回 Promise 也等待', async () => {
    await expect(
      attemptAsync(
        async () => {
          throw new Error('x');
        },
        async () => 'degraded',
      ),
    ).resolves.toBe('degraded');
  });

  it('onError 再抛 → rejection 原样传出', async () => {
    const second = new Error('fallback-broken');
    await expect(
      attemptAsync(
        async () => {
          throw new Error('first');
        },
        () => {
          throw second;
        },
      ),
    ).rejects.toThrow(second);
  });
});
