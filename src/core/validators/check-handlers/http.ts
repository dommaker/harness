/**
 * 检查点 http_* 族处理器（工单 23）
 */

import type { CheckpointCheck, CheckResult, CheckpointContext } from '../../../types/checkpoint';

/**
 * HTTP 调用重试（处理 httpbin rate-limit 503/429）
 */
async function fetchWithRetry(url: string, init?: RequestInit, retries = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, init);
      // 5xx / 429 → 重试，指数退避
      if (!response.ok && i < retries && (response.status >= 500 || response.status === 429)) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      return response;
    } catch (e) {
      lastError = e;
      if (i < retries) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastError;
}

export async function checkHttpStatus(check: CheckpointCheck, _context: CheckpointContext): Promise<CheckResult> {
  const url = check.config.url || '';
  const expected = check.config.expectedStatus || check.config.expected || 200;

  try {
    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(10000) });
    const actual = response.status;
    const matches = actual === expected;

    return {
      checkId: check.id,
      passed: matches,
      message: matches ? `HTTP 状态码匹配: ${expected}` : `HTTP 状态码不匹配: ${actual} != ${expected}`,
      actual,
      expected,
    };
  } catch (error: any) {
    return {
      checkId: check.id,
      passed: false,
      message: `HTTP 请求失败: ${url}`,
      actual: error.message,
      expected,
      error: error.message,
    };
  }
}

export async function checkHttpBody(check: CheckpointCheck, _context: CheckpointContext): Promise<CheckResult> {
  const url = check.config.url || '';
  const expected = String(check.config.expected || '');

  try {
    const response = await fetchWithRetry(url, {
      method: check.config.method || 'GET',
      headers: check.config.headers,
      body: check.config.body ? JSON.stringify(check.config.body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const actual = await response.text();
    const contains = actual.includes(expected);

    return {
      checkId: check.id,
      passed: contains,
      message: contains ? `HTTP 响应体包含: ${expected}` : `HTTP 响应体不包含: ${expected}`,
      actual,
      expected,
    };
  } catch (error: any) {
    return {
      checkId: check.id,
      passed: false,
      message: `HTTP 请求失败: ${url}`,
      actual: error.message,
      expected,
      error: error.message,
    };
  }
}
