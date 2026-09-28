/**
 * 模板侧轻量 glob 匹配（支持 `**`、`*`、`?`，纯字符串判定，不碰文件系统）
 *
 * glob→正则正本在 `utils/glob-match.ts`（与 completion-checkers 同一匹配语义，
 * utils 下游白名单内，分层守卫（harness#88）不违）。
 */

import { globToRegExp } from '../../../../utils/glob-match';

/** 单 glob 匹配（相对路径正斜杠口径） */
export function matchGlob(file: string, glob: string): boolean {
  return globToRegExp(glob).test(file);
}
