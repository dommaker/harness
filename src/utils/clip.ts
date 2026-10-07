/**
 * 证据行截断（正本）：templated checker（regex-scan / exec）共用口径
 */

/** 证据行单行长度上限（命中行可能是整行配置/长文本） */
export const MAX_LINE = 120;

/** trim 后超长截断加省略号 */
export function clip(line: string): string {
  const t = line.trim();
  return t.length > MAX_LINE ? `${t.slice(0, MAX_LINE)}…` : t;
}
