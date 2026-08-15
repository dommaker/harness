/**
 * Hook 配置归一映射语义测试（G7）
 *
 * blocking → errorStrategy 无损映射：
 * - blocking=true → 'block'（失败阻断管线）
 * - blocking=false → 'warn'（记录警告继续）
 */

import { toErrorStrategy } from '../config';

describe('toErrorStrategy（blocking → errorStrategy 无损映射，G7）', () => {
  it('blocking=true → block（失败阻断管线）', () => {
    expect(toErrorStrategy(true)).toBe('block');
  });

  it('blocking=false → warn（记录警告继续）', () => {
    expect(toErrorStrategy(false)).toBe('warn');
  });
});
