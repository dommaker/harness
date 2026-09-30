/**
 * 轻量 glob → 锚定正则（支持 `**`、`*`、`?`），纯字符串判定，不碰文件系统。
 *
 * 唯一正本（原 completion-checkers/glob-match.ts 与 core/constraints/checkers/
 * templated/glob.ts 逐字节重复，下沉 utils——core 与 completion-checkers 均在
 * utils 下游白名单，分层守卫（harness#88）不违）。
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** glob → 锚定正则。前缀 `**` + `/` 匹配零或多段路径；`*` 不跨 `/`；`?` 匹配单个非 `/` 字符 */
export function globToRegExp(glob: string): RegExp {
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
