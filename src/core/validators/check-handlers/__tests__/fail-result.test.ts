/**
 * check-handlers/fail-result — 失败 CheckResult 唯一构造测试（重构班次 3 Phase 3）
 */

import { failResult } from '../fail-result';

describe('failResult', () => {
  it('passed=false，detail 同落 actual 与 error，message/expected 归调用方', () => {
    expect(failResult('c1', '命令执行失败: ls', 'boom', 'exit code 0')).toEqual({
      checkId: 'c1',
      passed: false,
      message: '命令执行失败: ls',
      actual: 'boom',
      expected: 'exit code 0',
      error: 'boom',
    });
  });

  it('expected 保持各族原语义（字符串/数值/配置期望）', () => {
    expect(failResult('c2', 'HTTP 请求失败: u', 'timeout', 200).expected).toBe(200);
    expect(failResult('c3', '文件读取失败: f', 'denied', '> 0').expected).toBe('> 0');
  });
});
