/**
 * 文本工具正本（重构班次 3 Phase 3 下沉）
 */

/**
 * 正则元字符转义（MDN 标准口径，含 `*` `?`）。
 *
 * 注意区分 `utils/glob-match.ts` 内刻意**不含** `*?` 的私有变体——那份是
 * glob 语义专用（`*`/`?` 是 glob 算子不是字面量），两处语义不同，勿混用。
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 单行索引/表格单元口径：换行（含 \r）折叠为空格、`|` → `/`、
 * 连续空白折叠为一个空格、两端 trim。
 *
 * sdd 与 knowledge 两个 index-generator 的原地 sanitize 合一（骨架刻意平行不合并，
 * 见 knowledge/CONTEXT.md 约定；两变体输出等价——`\s+` 折叠兜底 `\r`）。
 */
export function sanitizeInline(s: string): string {
  return s.replace(/[\n\r]/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}
