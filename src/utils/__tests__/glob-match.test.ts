/**
 * utils/glob-match 旁测：globToRegExp 匹配语义（原 completion-checkers 与
 * core templated 两份逐字节重复实现的收敛正本）。
 */

import { describe, it, expect } from '@jest/globals';
import { globToRegExp } from '../glob-match';

describe('globToRegExp', () => {
  it('字面量精确匹配', () => {
    expect(globToRegExp('src/index.ts').test('src/index.ts')).toBe(true);
    expect(globToRegExp('src/index.ts').test('src/index.tsx')).toBe(false);
  });

  it('* 不跨路径分隔符', () => {
    const re = globToRegExp('src/*.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/sub/a.ts')).toBe(false);
  });

  it('**/ 前缀匹配零或多段路径', () => {
    const re = globToRegExp('**/*.test.ts');
    expect(re.test('a.test.ts')).toBe(true);
    expect(re.test('src/x/a.test.ts')).toBe(true);
    expect(re.test('src/a.spec.ts')).toBe(false);
  });

  it('** 不带 / 匹配任意字符（含 /）', () => {
    const re = globToRegExp('docs/**');
    expect(re.test('docs/a/b/c.md')).toBe(true);
    expect(re.test('src/docs/a.md')).toBe(false);
  });

  it('? 匹配单个非 / 字符', () => {
    const re = globToRegExp('a?.ts');
    expect(re.test('ab.ts')).toBe(true);
    expect(re.test('a/.ts')).toBe(false);
    expect(re.test('abb.ts')).toBe(false);
  });

  it('正则元字符按字面量转义', () => {
    const re = globToRegExp('a+b.(ts)');
    expect(re.test('a+b.(ts)')).toBe(true);
    expect(re.test('aab.ts)')).toBe(false);
  });

  it('锚定：不允许前后缀多余', () => {
    const re = globToRegExp('index.ts');
    expect(re.test('xindex.ts')).toBe(false);
    expect(re.test('index.ts.bak')).toBe(false);
  });
});
