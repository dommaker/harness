/**
 * 模板侧轻量 glob 匹配（支持 `**`、`*`、`?`，纯字符串判定，不碰文件系统）
 *
 * 与 completion-checkers/glob-match 同一匹配语义；此处另写一份是因为分层
 * （harness#88 参数化守卫）不许 core 值导入同层领域模块——约束域的模板
 * 参数匹配不住 completion-checkers 的 commits 分类模块。
 */

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

/** 单 glob 匹配（相对路径正斜杠口径） */
export function matchGlob(file: string, glob: string): boolean {
  return globToRegExp(glob).test(file);
}
