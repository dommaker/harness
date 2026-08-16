/**
 * 轻量 glob 匹配（支持 `**`、`*`、`?`），用于 commits 文件清单分类。
 * 不匹配文件系统，纯字符串判定。
 */

/** 默认测试文件 glob（Q2 定稿） */
export const DEFAULT_TEST_GLOBS = ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'];

/** 默认非代码文件 glob（兜底；权威清单由 yml noncode_globs 供给） */
export const DEFAULT_NONCODE_GLOBS = ['**/*.md', '**/*.mdx', '**/*.txt', 'docs/**'];

function escapeRegExp(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** glob → 锚定正则。前缀 `**` + `/` 匹配零或多段路径；`*` 不跨 `/`；`?` 匹配单个非 `/` 字符 */
function globToRegExp(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += escapeRegExp(c);
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

/** 单 glob 匹配 */
export function matchGlob(file: string, glob: string): boolean {
  return globToRegExp(glob).test(file);
}

/** 命中任一 glob */
export function matchAnyGlob(file: string, globs: string[]): boolean {
  return globs.some((g) => matchGlob(file, g));
}
