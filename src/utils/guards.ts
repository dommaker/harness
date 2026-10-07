/**
 * 类型守卫（正本）
 */

/** 是 plain object（非 null 非数组） */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
