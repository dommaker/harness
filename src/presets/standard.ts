/**
 * 约束预设（纯数据）
 *
 * 预设定义哪些内置约束被启用。筛选与合并逻辑统一在
 * core/project-config-loader.ts 的 mergeConstraints（ADR-0001 生效集链路），
 * 本文件只保留预设数据，不再含函数。
 *
 * ADR-0001：kind 二元（check + prompt 纯注入层）。
 */

/**
 * 预设配置
 */
export interface PresetConfig {
  /** 预设名称 */
  name: string;

  /** 启用的铁律 ID 列表（null 表示全部启用） */
  ironLaws: string[] | null;

  /** 启用的指导原则 ID 列表（null 表示全部启用） */
  guidelines: string[] | null;

  /** 启用的提示 ID 列表（null 表示全部启用） */
  prompts: string[] | null;
}

/**
 * 严格预设
 *
 * 所有约束全部启用（与 standard 同集，保留别名兼容历史配置）
 */
export const STRICT_PRESET: PresetConfig = {
  name: 'strict',
  ironLaws: null,    // 全部启用
  guidelines: null,  // 全部启用
  prompts: null,     // 全部启用
};

/**
 * 标准预设
 *
 * 铁律全部启用，指导原则和提示选择性启用
 */
export const STANDARD_PRESET: PresetConfig = {
  name: 'standard',
  ironLaws: null,    // 全部启用
  guidelines: null,  // 全部启用
  prompts: null,     // 全部启用
};

/**
 * 宽松预设
 *
 * 仅启用核心铁律，禁用提示
 */
export const RELAXED_PRESET: PresetConfig = {
  name: 'relaxed',
  ironLaws: [
    'no_completion_without_verification',
    'incremental_progress',
    'no_implementation_without_requirement',
  ],
  guidelines: [
    'no_bypass_checkpoint',
    'no_hardcoded_credentials',
  ],
  prompts: [],  // 禁用提示
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
