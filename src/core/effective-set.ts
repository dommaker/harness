/**
 * 生效集共享筛选器（ADR-0001 收口）
 *
 * 「config.yml 引用了哪些 id、哪些被 enabled:false 裁剪」的判定唯一实现。
 * 两种未知 id 处理模式按语义分，不按调用方分：
 * - `'collect'`：静默忽略，收集进结果 `unknownIds` 供诊断——历史配置可能残留已移除条目的
 *   禁用键，故不能抛错（现唯一生产调用方：`ProjectConfigLoader.mergeConstraints`）
 * - `'throw'`：立即抛错，配合 `unknownIdError` 定制消息——用于「配置段为新增面、
 *   不存在历史残留需静默兼容」的场景（门禁侧曾用 `getEffectiveGates` 如此，该面已按
 *   ADR-0022 口径收缩，见 ADR-0002 文末「后续变更」；本模式当前无生产调用方）
 *
 * 行为差异仅收敛为 onUnknownId 一个开关，筛选语义两种模式一致。
 */

export interface FilterEnabledEntriesOptions {
  /** 未知 id 处理：'collect' 收集进结果 unknownIds；'throw' 立即抛错 */
  onUnknownId: 'collect' | 'throw';

  /** onUnknownId='throw' 时的错误消息定制（如附带可用 id 清单） */
  unknownIdError?: (id: string) => string;
}

export interface FilterEnabledEntriesResult {
  /** enabled === false 的 id（未知 id 若带 enabled:false 同样计入，与历史行为一致） */
  disabledIds: string[];

  /** 未知 id（仅 onUnknownId='collect' 时非空） */
  unknownIds: string[];
}

/**
 * 按 config 条目筛选：未知 id 按 onUnknownId 处理，enabled:false 收进 disabledIds
 */
export function filterEnabledEntries(
  knownIds: ReadonlySet<string>,
  entries: Record<string, { enabled?: boolean } | undefined>,
  options: FilterEnabledEntriesOptions
): FilterEnabledEntriesResult {
  const disabledIds: string[] = [];
  const unknownIds: string[] = [];

  for (const [id, entry] of Object.entries(entries)) {
    if (!knownIds.has(id)) {
      if (options.onUnknownId === 'throw') {
        throw new Error(
          options.unknownIdError?.(id) ??
            `[harness] 配置引用了未注册的 id "${id}"。`
        );
      }
      unknownIds.push(id);
    }
    if (entry?.enabled === false) {
      disabledIds.push(id);
    }
  }

  return { disabledIds, unknownIds };
}
