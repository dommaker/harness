/**
 * 约束 trigger 归一与匹配（harness#105 单点）
 *
 * 约束域谓词，不是通用工具：`normalizeTriggers` 的「undefined → []」语义只在
 * trigger 字段上成立；`matchesTrigger` 的「未声明 = 恒匹配」同理（ADR-0040
 * Phase 4：应用层约束缺省 trigger 改恒评估，硬编码操作清单出清）。
 * 此前二者住在 `utils/exec.ts`、由 core/constraints 跨模块拉用，utils 层因此挂着
 * 一枚只有约束域会调的假接缝（harness#137 归位）。
 * checker 与 prompt 渲染共用本模块，禁止就地重写。
 */

/**
 * 将单值或数组统一为数组（用于 trigger 等字段）
 */
export function normalizeTriggers<T>(
  value: T | T[] | undefined,
  fallback: T[] = []
): T[] {
  if (value === undefined || value === null) return fallback;
  return Array.isArray(value) ? value : [value];
}

/**
 * 判断约束是否匹配当前操作集合（#105：trigger 匹配语义单一来源）
 *
 * 语义（ADR-0040 Phase 4 收口）：trigger **未声明**（undefined）= 无触发域限制，
 * 恒匹配——应用层约束的缺省语义「每次 check 都评估」由此表达，不再靠硬编码
 * 操作清单凑数；显式声明（含空数组）走交集判定，任一 operation 命中任一
 * trigger 即匹配，空数组不匹配任何操作。
 */
export function matchesTrigger<T>(
  constraint: { trigger?: T | T[] | undefined },
  operations: T[]
): boolean {
  if (constraint.trigger === undefined) return true;
  const triggers = normalizeTriggers(constraint.trigger);
  return operations.some(op => triggers.includes(op));
}
