/**
 * 轻量 glob 匹配（支持 `**`、`*`、`?`），用于 commits 文件清单分类。
 * 不匹配文件系统，纯字符串判定。glob→正则正本在 `utils/glob-match.ts`。
 */

import { globToRegExp } from '../utils/glob-match';

/** 默认测试文件 glob（Q2 定稿） */
export const DEFAULT_TEST_GLOBS = ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'];

/** 默认非代码文件 glob（兜底；权威清单由 yml noncode_globs 供给） */
export const DEFAULT_NONCODE_GLOBS = ['**/*.md', '**/*.mdx', '**/*.txt', 'docs/**'];

/** 单 glob 匹配 */
export function matchGlob(file: string, glob: string): boolean {
  return globToRegExp(glob).test(file);
}

/** 命中任一 glob */
export function matchAnyGlob(file: string, globs: string[]): boolean {
  return globs.some((g) => matchGlob(file, g));
}
