/**
 * utils/text — escapeRegExp / sanitizeInline 正本测试（重构班次 3 Phase 3）
 */

import { escapeRegExp, sanitizeInline } from '../text';

describe('escapeRegExp', () => {
  it('转义全部正则元字符（含 * ?——与 glob-match 私有变体的口径差异）', () => {
    expect(escapeRegExp('a.b*c?d')).toBe('a\\.b\\*c\\?d');
    expect(escapeRegExp('[x](y){2}^$|+')).toBe('\\[x\\]\\(y\\)\\{2\\}\\^\\$\\|\\+');
    expect(escapeRegExp('path\\to')).toBe('path\\\\to');
  });

  it('转义后可安全拼入 RegExp 并逐字命中', () => {
    const literal = '## 章节 (v2) [draft]';
    expect(new RegExp(escapeRegExp(literal)).test(literal)).toBe(true);
    expect(new RegExp(`^${escapeRegExp('a.b')}$`).test('axb')).toBe(false);
  });

  it('普通字符串原样返回', () => {
    expect(escapeRegExp('plain-text_123')).toBe('plain-text_123');
  });
});

describe('sanitizeInline', () => {
  it('换行（含 \\r）折叠为空格', () => {
    expect(sanitizeInline('line1\nline2')).toBe('line1 line2');
    expect(sanitizeInline('line1\r\nline2')).toBe('line1 line2');
  });

  it('竖线转义为斜杠（表格/索引单元口径）', () => {
    expect(sanitizeInline('a|b')).toBe('a/b');
  });

  it('连续空白折叠为一个空格并 trim', () => {
    expect(sanitizeInline('  a \t  b  ')).toBe('a b');
  });
});
