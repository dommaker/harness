/**
 * unknown 错误取信正本（重构班次 3 Phase 3）
 *
 * 取代散布各层的 `err instanceof Error ? err.message : String(err)` 手写三元
 * （20+ 处逐字重复）。Error 取 message，其余 String() 直转——与手写三元逐字同语义。
 */

/**
 * 取错误的可读消息：Error → message；非 Error（字符串/数值/异域对象）→ String(err)
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
