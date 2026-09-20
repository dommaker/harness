/**
 * 约束预设（纯数据）
 *
 * 预设定义哪些内置约束被启用。筛选与合并逻辑统一在
 * core/project-config-loader.ts 的 mergeConstraints（生效集链路），
 * 本文件只保留预设数据，不再含函数。
 *
 * ADR-0029：桶按 severity 命名（errors / warnings），取代三层命名。
 */

/**
 * 预设配置
 */
export interface PresetConfig {
  /** 预设名称 */
  name: string;

  /** 启用的 severity='error' 约束 ID 列表（null 表示全部启用） */
  errors: string[] | null;

  /** 启用的 severity='warning' 约束 ID 列表（null 表示全部启用） */
  warnings: string[] | null;
}

/**
 * 严格预设
 *
 * 所有约束全部启用（与 standard 同集，保留别名兼容历史配置）
 */
export const STRICT_PRESET: PresetConfig = {
  name: 'strict',
  errors: null,    // 全部启用
  warnings: null,  // 全部启用
};

/**
 * 标准预设
 *
 * 全部约束启用
 */
export const STANDARD_PRESET: PresetConfig = {
  name: 'standard',
  errors: null,    // 全部启用
  warnings: null,  // 全部启用
};

/**
 * 宽松预设
 *
 * 仅启用核心 error 级与凭证扫描
 */
export const RELAXED_PRESET: PresetConfig = {
  name: 'relaxed',
  errors: [
    'no_completion_without_verification',
  ],
  warnings: [
    'no_hardcoded_credentials',
  ],
};

/**
 * 预设名 → 预设数据
 *
 * strict 是 standard 的别名（两者同为全部启用）。未知名不在此表，
 * 由 mergeConstraints 回落 standard + stderr 警告。
 */
export const PRESETS_BY_NAME: Record<string, PresetConfig> = {
  strict: STRICT_PRESET,
  standard: STANDARD_PRESET,
  relaxed: RELAXED_PRESET,
};
