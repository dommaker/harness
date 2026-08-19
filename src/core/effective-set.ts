/**
 * 生效集共享筛选器（ADR-0001 收口）
 *
 * 「config.yml 引用了哪些 id、哪些被禁用」的判定，约束侧与门禁侧共用一份：
 * - 约束侧（ProjectConfigLoader.mergeConstraints）：未知 id 静默忽略，
 *   收集进结果 unknownIds 供诊断（历史配置可能存在已移除约束的禁用残留）
 * - 门禁侧（getEffectiveGates）：未知 id 抛错（闭环校验；gates 配置段为
 *   新增面，不存在历史残留配置）
 *
 * 行为差异仅收敛为 onUnknownId 一个开关，筛选语义两侧一致。
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
