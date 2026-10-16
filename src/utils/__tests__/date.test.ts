/**
 * utils/date — isoDate / compactDate 正本测试（重构班次 3 Phase 3）
 */

import { isoDate, compactDate } from '../date';

describe('isoDate', () => {
  it('YYYY-MM-DD（UTC 口径）', () => {
    expect(isoDate(new Date('2026-08-08T12:00:00.000Z'))).toBe('2026-08-08');
    expect(isoDate(new Date(0))).toBe('1970-01-01');
  });
});

describe('compactDate', () => {
  it('YYYYMMDD（产物文件名口径）', () => {
    expect(compactDate(new Date('2026-08-08T12:00:00.000Z'))).toBe('20260808');
  });
});
