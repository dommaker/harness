/**
 * http 检查项的重试退避等待注入（工单 #136）
 *
 * 退避等待经 CheckpointContext.sleep 注入后，重试语义（尝试次数、退避序列）由记录
 * 替身钉住，不再靠真 sleep 证明；未注入的缺省路径同时钉住「走真定时器、序列不变」。
 */

import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { CheckpointValidator } from '../checkpoint';
import { checkHttpBody, checkHttpStatus } from '../check-handlers/http';
import type { CheckConfig, CheckType } from '../../../types/checkpoint';
import type { CheckpointCheck, CheckpointContext } from '../../../types/checkpoint';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function makeContext(overrides: Partial<CheckpointContext> = {}): CheckpointContext {
  return { projectPath: process.cwd(), workdir: process.cwd(), ...overrides };
}

function makeCheck(id: string, type: CheckType, config: CheckConfig): CheckpointCheck {
  return { id, type, config };
}

type InjectedSleep = NonNullable<CheckpointContext['sleep']>;

/** 记录型零等待替身：记下每次退避请求的毫秒数 */
function recordingSleep(): { waits: number[]; sleep: InjectedSleep } {
  const waits: number[] = [];
  const sleep: InjectedSleep = async (ms: number) => {
    waits.push(ms);
  };
  return { waits, sleep };
}

/** 按脚本依次出牌的 fetch 替身：条目耗尽后重复最后一张；返回调用记录 */
function scriptedFetch(script: Array<number | Error>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url));
    const next = script[Math.min(calls.length - 1, script.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(null, { status: next });
  }) as unknown as typeof fetch;
  return calls;
}

const URL_OK = 'https://example.com';

describe('http_status 重试退避（注入 sleep）', () => {
  it('fetch 持续抛错：尝试 4 次、退避 2000/4000/6000、全程零真等待', async () => {
    const { waits, sleep } = recordingSleep();
    const calls = scriptedFetch([new Error('Network error')]);

    const startedAt = Date.now();
    const result = await checkHttpStatus(
      makeCheck('c-reject', 'http_status', { url: URL_OK, expectedStatus: 200 }),
      makeContext({ sleep })
    );
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(2000);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([2000, 4000, 6000]);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('请求失败');
  });

  it('5xx 后恢复：尝试 2 次、只退避一次 2000', async () => {
    const { waits, sleep } = recordingSleep();
    const calls = scriptedFetch([503, 200]);

    const result = await checkHttpStatus(
      makeCheck('c-503', 'http_status', { url: URL_OK, expectedStatus: 200 }),
      makeContext({ sleep })
    );

    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
    expect(result.passed).toBe(true);
  });

  it('429 后恢复：尝试 2 次、只退避一次 2000', async () => {
    const { waits, sleep } = recordingSleep();
    const calls = scriptedFetch([429, 200]);

    const result = await checkHttpStatus(
      makeCheck('c-429', 'http_status', { url: URL_OK, expectedStatus: 200 }),
      makeContext({ sleep })
    );

    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
    expect(result.passed).toBe(true);
  });

  it('5xx 不恢复：退避用尽后返回最后响应，判状态码不匹配', async () => {
    const { waits, sleep } = recordingSleep();
    const calls = scriptedFetch([500]);

    const result = await checkHttpStatus(
      makeCheck('c-500', 'http_status', { url: URL_OK, expectedStatus: 200 }),
      makeContext({ sleep })
    );

    expect(calls).toHaveLength(4);
    expect(waits).toEqual([2000, 4000, 6000]);
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(500);
    expect(result.message).toContain('不匹配');
  });

  it('404 非可重试状态码：只尝试 1 次、零退避', async () => {
    const { waits, sleep } = recordingSleep();
    const calls = scriptedFetch([404]);

    const result = await checkHttpStatus(
      makeCheck('c-404', 'http_status', { url: URL_OK, expectedStatus: 200 }),
      makeContext({ sleep })
    );

    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('不匹配');
  });

  it('首次即成功：不产生任何退避', async () => {
    const { waits, sleep } = recordingSleep();
    const calls = scriptedFetch([200]);

    const result = await checkHttpStatus(
      makeCheck('c-200', 'http_status', { url: URL_OK, expectedStatus: 200 }),
      makeContext({ sleep })
    );

    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe('http_body 重试退避（注入 sleep）', () => {
  it('fetch 持续抛错：尝试 4 次、退避 2000/4000/6000、全程零真等待', async () => {
    const { waits, sleep } = recordingSleep();
    const calls = scriptedFetch([new Error('Network error')]);

    const startedAt = Date.now();
    const result = await checkHttpBody(
      makeCheck('c-body-reject', 'http_body', { url: URL_OK, expected: 'test' }),
      makeContext({ sleep })
    );
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(2000);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([2000, 4000, 6000]);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('请求失败');
  });

  it('响应体不含期望值：不重试、只尝试 1 次', async () => {
    const { waits, sleep } = recordingSleep();
    globalThis.fetch = (async () => new Response('{"data": "test"}', { status: 200 })) as unknown as typeof fetch;

    const result = await checkHttpBody(
      makeCheck('c-body-miss', 'http_body', { url: URL_OK, expected: 'NONEXISTENT' }),
      makeContext({ sleep })
    );

    expect(waits).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('不包含');
  });
});

describe('未注入 sleep 的缺省路径（生产行为逐字不变）', () => {
  it('退避仍走真 setTimeout，且序列为 2000/4000/6000', async () => {
    // 替身把 setTimeout 改成同步触发：缺省路径的「真定时器 + 退避毫秒数」一并钉住且不真等
    // （AbortSignal.timeout 走 Node 内部计时器、不经 globalThis.setTimeout，实测收不到干扰）
    const delays: number[] = [];
    const spy = jest.spyOn(globalThis, 'setTimeout').mockImplementation((
      (callback: (...args: unknown[]) => void, ms?: number) => {
        delays.push(ms ?? 0);
        callback();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
    ) as unknown as typeof setTimeout);

    try {
      const calls = scriptedFetch([new Error('Network error')]);
      const startedAt = Date.now();
      const result = await checkHttpStatus(
        makeCheck('c-default', 'http_status', { url: URL_OK, expectedStatus: 200 }),
        makeContext()
      );
      const elapsed = Date.now() - startedAt;

      expect(calls).toHaveLength(4);
      expect(delays).toEqual([2000, 4000, 6000]);
      expect(elapsed).toBeLessThan(2000);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('请求失败');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('CheckpointValidator → http handler 的 context 接线', () => {
  it('validate() 传入的 sleep 抵达 handler：重试全程零真等待', async () => {
    const { waits, sleep } = recordingSleep();
    const calls = scriptedFetch([new Error('Network error')]);

    const result = await CheckpointValidator.getInstance().validate(
      {
        id: 'cp-wiring',
        checks: [makeCheck('c-wiring', 'http_status', { url: URL_OK, expectedStatus: 200 })],
      },
      makeContext({ sleep })
    );

    expect(calls).toHaveLength(4);
    expect(waits).toEqual([2000, 4000, 6000]);
    expect(result.passed).toBe(false);
    expect(result.checks[0].message).toContain('请求失败');
  });
});
