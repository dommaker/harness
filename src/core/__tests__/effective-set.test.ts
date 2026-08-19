/**
 * effective-set 共享筛选器测试
 *
 * 覆盖约束侧（collect）与门禁侧（throw）两种 onUnknownId 模式。
 */

import { filterEnabledEntries } from '../effective-set';

const KNOWN = new Set(['a', 'b', 'c']);

describe('filterEnabledEntries', () => {
  describe('onUnknownId: collect（约束侧）', () => {
    it('已知 id 全部通过，enabled:false 收进 disabledIds', () => {
      const result = filterEnabledEntries(
        KNOWN,
        { a: { enabled: false }, b: { enabled: true }, c: {} },
        { onUnknownId: 'collect' }
      );
      expect(result.disabledIds).toEqual(['a']);
      expect(result.unknownIds).toEqual([]);
    });

    it('未知 id 静默忽略并收集进 unknownIds', () => {
      const result = filterEnabledEntries(
        KNOWN,
        { a: {}, ghost: { enabled: false } },
        { onUnknownId: 'collect' }
      );
      expect(result.unknownIds).toEqual(['ghost']);
      // 未知 id 带 enabled:false 同样计入 disabledIds（历史行为：delete 空桶为 no-op）
      expect(result.disabledIds).toEqual(['ghost']);
    });

    it('未知 id 无 enabled 标记时只收集不进 disabledIds', () => {
      const result = filterEnabledEntries(
        KNOWN,
        { ghost: {} },
        { onUnknownId: 'collect' }
      );
      expect(result.unknownIds).toEqual(['ghost']);
      expect(result.disabledIds).toEqual([]);
    });

    it('空 entries → 空结果', () => {
      const result = filterEnabledEntries(KNOWN, {}, { onUnknownId: 'collect' });
      expect(result).toEqual({ disabledIds: [], unknownIds: [] });
    });
  });

  describe('onUnknownId: throw（门禁侧）', () => {
    it('未知 id 抛错（默认消息）', () => {
      expect(() =>
        filterEnabledEntries(KNOWN, { nope: { enabled: false } }, { onUnknownId: 'throw' })
      ).toThrow(/未注册的 id "nope"/);
    });

    it('未知 id 抛错（unknownIdError 定制消息）', () => {
      expect(() =>
        filterEnabledEntries(
          KNOWN,
          { nope: {} },
          {
            onUnknownId: 'throw',
            unknownIdError: id => `gates.${id} 引用了未注册的门禁。可用门禁: a, b, c。`,
          }
        )
      ).toThrow(/gates\.nope 引用了未注册的门禁/);
    });

    it('已知 id 的 enabled:false 正常收集，不抛错', () => {
      const result = filterEnabledEntries(
        KNOWN,
        { a: { enabled: false }, b: { enabled: true } },
        { onUnknownId: 'throw' }
      );
      expect(result.disabledIds).toEqual(['a']);
      expect(result.unknownIds).toEqual([]);
    });
  });
});
