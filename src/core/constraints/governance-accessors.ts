/**
 * governance 访问器族（工单 84）
 *
 * 原住 core/project-config-loader，为使 constraints/checkers 不再回头依赖 core 根
 * （loader → app-constraints-loader → 模板注册表 → 内置 checker 的值级循环源头）
 * 下移本模块。rawConfig 直取 run-env 观察面，不经 project-config-loader——
 * 经它即把循环重新闭合。
 */

import type { CapabilitiesConfig, GovernanceConfig } from '../../types/project-config';
import { resolveRunEnv, type RunTarget } from './run-env';
import { attempt } from '../../utils/attempt';

/**
 * CAPABILITIES.md 登记模式（governance.capabilities.mode）
 */
export type CapabilitiesMode = NonNullable<CapabilitiesConfig['mode']>;

/**
 * 读取 governance 段（全仓唯一手写钻取点，工单 84）
 *
 * 配置缺失 / 形状不符时返回 undefined，由调用方按未配置处理。
 * 解析失败经 attempt 显式降级为 undefined（工单 84 triage 裁决口径：解析失败 = 约定未采用，
 * 访问器不替调用方决定要不要炸；执法面要感知脏配置请用 loadRawProjectConfig 直读）。
 * 入参形状同 loadRawProjectConfig：传 RunEnv 即与本 run 其余消费方共用同一份 config.yml 读取。
 */
export function getGovernanceConfig(target: RunTarget): GovernanceConfig | undefined {
  return attempt(() => {
    const raw = resolveRunEnv(target).rawConfig();
    const governance = raw?.governance;
    if (governance === null || typeof governance !== 'object') return undefined;
    return governance as GovernanceConfig;
  }, () => undefined);
}

/**
 * governance.context_files 三态分辨率（工单 84 triage 裁决口径）
 *
 * - unconfigured：段缺失 / enabled 为假 / 解析失败——约定未采用
 * - enabled-empty：enabled 但 required_dirs 缺失、非数组、含非字符串项或空——
 *   约定已立但无可用目标
 * - enabled：enabled 且 required_dirs 为非空字符串数组——约定有效
 */
export type ContextFilesResolution =
  | { state: 'unconfigured' }
  | { state: 'enabled-empty' }
  | { state: 'enabled'; dirs: string[] };

/**
 * 分辨 governance.context_files 三态（语义见 ContextFilesResolution）
 *
 * 消费方约定：约束 checker 对前两态一律 skip（与 ADR-0001 存在性探测同构）；
 * init / 扫描类工具流的自动探测回落保留在调用方，不进本访问器。
 * 元素类型在此收口：脏配置（如 required_dirs: [1]）不得流入调用方 path.join。
 */
export function resolveContextFiles(target: RunTarget): ContextFilesResolution {
  const contextFiles = getGovernanceConfig(target)?.context_files;
  if (!contextFiles?.enabled) return { state: 'unconfigured' };
  const dirs = contextFiles.required_dirs;
  if (!Array.isArray(dirs) || dirs.length === 0) return { state: 'enabled-empty' };
  if (!dirs.every(dir => typeof dir === 'string')) return { state: 'enabled-empty' };
  return { state: 'enabled', dirs };
}

/**
 * 读取 governance.capabilities.mode（缺省 'file'，向后兼容）
 *
 * 配置缺失/解析失败/取值非法时一律回落 'file'。
 */
export function getCapabilitiesMode(target: RunTarget): CapabilitiesMode {
  const mode = getGovernanceConfig(target)?.capabilities?.mode;
  if (mode === 'file' || mode === 'module' || mode === 'listing') return mode;
  return 'file';
}
