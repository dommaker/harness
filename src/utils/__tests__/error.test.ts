/**
 * utils/error — errorMessage 正本测试（重构班次 3 Phase 3）
 */

import { errorMessage } from '../error';

describe('errorMessage', () => {
  it('Error → message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(new TypeError('bad type'))).toBe('bad type');
  });

  it('非 Error 抛出物 → String() 直转（与手写三元同语义）', () => {
    expect(errorMessage('字符串错误')).toBe('字符串错误');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage({ weird: true })).toBe('[object Object]');
  });
});
