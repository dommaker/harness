/**
 * effective-set 共享筛选器测试
 *
 * 筛选语义单一（未知 id 静默忽略并收集进 unknownIds）；「新形状钉」一组钉住 throw 模式已删除。
 */

import { filterEnabledEntries } from '../effective-set';

const KNOWN = new Set(['a', 'b', 'c']);

describe('filterEnabledEntries', () => {
  it('已知 id 全部通过，enabled:false 收进 disabledIds', () => {
    const result = filterEnabledEntries(KNOWN, {
      a: { enabled: false },
      b: { enabled: true },
      c: {},
    });
    expect(result.disabledIds).toEqual(['a']);
    expect(result.unknownIds).toEqual([]);
  });

  it('未知 id 静默忽略并收集进 unknownIds', () => {
    const result = filterEnabledEntries(KNOWN, { a: {}, ghost: { enabled: false } });
    expect(result.unknownIds).toEqual(['ghost']);
    // 未知 id 带 enabled:false 同样计入 disabledIds（历史行为：delete 空桶为 no-op）
    expect(result.disabledIds).toEqual(['ghost']);
  });

  it('未知 id 无 enabled 标记时只收集不进 disabledIds', () => {
    const result = filterEnabledEntries(KNOWN, { ghost: {} });
    expect(result.unknownIds).toEqual(['ghost']);
    expect(result.disabledIds).toEqual([]);
  });

  it('空 entries → 空结果', () => {
    const result = filterEnabledEntries(KNOWN, {});
    expect(result).toEqual({ disabledIds: [], unknownIds: [] });
  });
});

describe('新形状钉（throw 模式已按 ADR-0022 判据删除，harness#141）', () => {
  it('形参只有 knownIds/entries 两个（运行期钉）', () => {
    expect(filterEnabledEntries.length).toBe(2);
  });

  it('选项参数不再是合法入参（编译期钉）', () => {
    // @ts-expect-error onUnknownId/unknownIdError 随 throw 模式一并删除，调用面不接收第三参数
    filterEnabledEntries(KNOWN, { nope: {} }, { onUnknownId: 'throw' });
  });

  it('FilterEnabledEntriesOptions 不再是可导入类型（编译期钉）', () => {
    // @ts-expect-error 选项类型随其唯一成员（onUnknownId）一并消失
    const removed: import('../effective-set').FilterEnabledEntriesOptions | undefined = undefined;
    expect(removed).toBeUndefined();
  });
});
