/**
 * 预设模块入口
 */

export {
  STRICT_PRESET,
  STANDARD_PRESET,
  RELAXED_PRESET,
  getPreset,
  applyPreset,
  // 向后兼容
  STANDARD_IRON_LAWS_CONFIG,
  getIronLawPreset,
} from './standard';

export type { PresetConfig } from './standard';