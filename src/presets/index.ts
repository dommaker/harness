/**
 * 预设模块入口（纯数据，ADR-0001：筛选逻辑统一在 mergeConstraints）
 */

export {
  STRICT_PRESET,
  STANDARD_PRESET,
  RELAXED_PRESET,
  PRESETS_BY_NAME,
} from './standard';

export type { PresetConfig } from './standard';
