/**
 * 约束预设
 * 
 * 预设定义哪些约束被启用
 */

import type { ConstraintLevel, Constraint } from '../types/constraint';
import type { MergedConstraintsConfig } from '../types/project-config';
import { IRON_LAWS, GUIDELINES, TIPS } from '../core/constraints/definitions';

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
  tips: string[] | null;
}

/**
 * 应用预设，生成 MergedConstraintsConfig（S12）
 *
 * 将 PresetConfig 转换为 ConstraintChecker.checkConstraints() 所需的 customConfig。
 * 支持 per-request 预设切换，不再局限于 CLI。
 *
 * @param preset 预设名称（'strict' | 'standard' | 'relaxed'）或 PresetConfig 对象
 * @returns 可直接传入 checkConstraints() 的 merged config
 *
 * 用法：
 * ```typescript
 * const config = applyPreset('relaxed');
 * await checker.checkConstraints(ctx, config);
 * ```
 */
export function applyPreset(
  preset: string | PresetConfig
): MergedConstraintsConfig {
  const cfg = typeof preset === 'string' ? getPreset(preset) : preset;

  const filterByIds = (
    source: Record<string, Constraint>,
    ids: string[] | null,
  ): Record<string, Constraint> => {
    if (ids === null) return { ...source };
    const filtered: Record<string, Constraint> = {};
    for (const id of ids) {
      if (source[id]) filtered[id] = source[id];
    }
    return filtered;
  };

  const disabled: string[] = [];
  if (cfg.ironLaws !== null) {
    for (const id of Object.keys(IRON_LAWS)) {
      if (!cfg.ironLaws.includes(id)) disabled.push(id);
    }
  }
  if (cfg.guidelines !== null) {
    for (const id of Object.keys(GUIDELINES)) {
      if (!cfg.guidelines.includes(id)) disabled.push(id);
    }
  }

  return {
    ironLaws: filterByIds(IRON_LAWS, cfg.ironLaws),
    guidelines: filterByIds(GUIDELINES, cfg.guidelines),
    tips: filterByIds(TIPS, cfg.tips),
    disabled,
    custom: [],
  };
}

/**
 * 严格预设
 * 
 * 所有约束全部启用
 */
export const STRICT_PRESET: PresetConfig = {
  name: 'strict',
  ironLaws: null,    // 全部启用
  guidelines: null,  // 全部启用
  tips: null,        // 全部启用
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
  tips: null,        // 全部启用
};

/**
 * 宽松预设
 * 
 * 仅启用核心铁律，禁用提示
 */
export const RELAXED_PRESET: PresetConfig = {
  name: 'relaxed',
  ironLaws: [
    'no_bypass_checkpoint',
    'no_self_approval',
    'no_completion_without_verification',
  ],
  guidelines: [
    'no_fix_without_root_cause',
    'no_code_without_test',
  ],
  tips: [],  // 禁用提示
};

/**
 * 获取预设
 */
export function getPreset(name: string): PresetConfig {
  switch (name) {
    case 'strict':
      return STRICT_PRESET;
    case 'standard':
      return STANDARD_PRESET;
    case 'relaxed':
      return RELAXED_PRESET;
    default:
      return STANDARD_PRESET;
  }
}

// ========================================
// 向后兼容
// ========================================

import type { IronLawConfig } from '../types/iron-law';

/**
 * @deprecated 使用 PresetConfig 代替
 */
export { STANDARD_PRESET as STANDARD_IRON_LAWS_CONFIG };

/**
 * @deprecated 使用 getPreset 代替
 */
export function getIronLawPreset(preset: string): IronLawConfig {
  const config = getPreset(preset);
  return {
    preset: preset as 'strict' | 'standard' | 'relaxed',
    enabled: true,
    ironLaws: config.ironLaws 
      ? Object.values(IRON_LAWS).filter(c => config.ironLaws!.includes(c.id))
      : Object.values(IRON_LAWS),
  };
}