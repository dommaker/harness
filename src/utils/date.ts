/**
 * 日期格式正本（重构班次 3 Phase 3）
 *
 * 取代散布的 `d.toISOString().slice(0, 10)` 与 `.replace(/-/g, '')` 手写片段。
 * 均为 UTC 口径（toISOString 恒 UTC）。
 */

/** YYYY-MM-DD（ISO 日期前缀） */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** YYYYMMDD（紧凑日期，产物文件名口径） */
export function compactDate(d: Date): string {
  return isoDate(d).replace(/-/g, '');
}
