/**
 * 生效集共享筛选器（ADR-0001 收口）
 *
 * 「config.yml 引用了哪些 id、哪些被 enabled:false 裁剪」的判定唯一实现。
 * 未知 id 静默忽略并收集进结果 `unknownIds` 供诊断——历史配置可能残留已移除条目的禁用键，
 * 故不能抛错。唯一生产调用方：`ProjectConfigLoader.mergeConstraints`。
 *
 * 去向指引：本函数曾带一个按语义分的 `'throw'` 模式（引用未注册即抛错），其唯一生产调用方
 * 消失后已按 ADR-0022 判据删除——背景见 ADR-0002 文末「后续变更」，票 harness#141。
 */

export interface FilterEnabledEntriesResult {
  /** enabled === false 的 id（未知 id 若带 enabled:false 同样计入，与历史行为一致） */
  disabledIds: string[];

  /** config 条目里未注册的 id，供调用方诊断 */
  unknownIds: string[];
}

/**
 * 按 config 条目筛选：未知 id 收集进 unknownIds，enabled:false 收进 disabledIds
 */
export function filterEnabledEntries(
  knownIds: ReadonlySet<string>,
  entries: Record<string, { enabled?: boolean } | undefined>
): FilterEnabledEntriesResult {
  const disabledIds: string[] = [];
  const unknownIds: string[] = [];

  for (const [id, entry] of Object.entries(entries)) {
    if (!knownIds.has(id)) {
      unknownIds.push(id);
    }
    if (entry?.enabled === false) {
      disabledIds.push(id);
    }
  }

  return { disabledIds, unknownIds };
}
