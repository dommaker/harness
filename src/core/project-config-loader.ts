/**
 * 项目配置加载器
 *
 * 解读 `.harness/config.yml` 与自定义约束文件、合并内置与项目自定义约束。
 * 本模块不碰文件系统：两份配置的读取口径 = 运行级观察面（`constraints/run-env.ts`，
 * ADR-0023 决策 2），一次运行内各至多读一次。
 */

import type { Constraint } from '../types/constraint';
import type {
  ProjectConfig,
  MergedConstraintsConfig,
  CapabilitiesConfig,
  GovernanceConfig,
} from '../types/project-config';
import { CONSTRAINTS } from './constraints/definitions';
import { PRESETS_BY_NAME, STANDARD_PRESET } from '../presets';
import { filterEnabledEntries } from './effective-set';
import { resolveRunEnv, type RunEnv, type RunTarget } from './constraints/run-env';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ProjectConfig = {
  preset: 'standard',
};

/**
 * 读取并解析 `.harness/config.yml`
 *
 * 实面 = `RunEnv.rawConfig()`（ADR-0023 决策 2），本函数只是它的「只此一次」形状：
 * 传项目根字符串即自造一枚用完即弃的观察面（每次调用都读当下内容），
 * 传调用方那枚 RunEnv 则与本 run 的其余消费方共用同一份读取。
 * 原进程级 `rawConfigCache` + mtime/size 指纹已撤销——见 ADR-0023 决策 2 与工单 16 的撤销记录。
 *
 * 文件不存在时返回 undefined；解析失败向上抛出（由各调用方自行兜底）。
 */
export function loadRawProjectConfig(target: RunTarget): Record<string, unknown> | undefined {
  return resolveRunEnv(target).rawConfig();
}

/**
 * CAPABILITIES.md 登记模式（governance.capabilities.mode）
 */
export type CapabilitiesMode = NonNullable<CapabilitiesConfig['mode']>;

/**
 * 读取 governance 段（全仓唯一手写钻取点，工单 84）
 *
 * 配置缺失 / 解析失败 / 形状不符时返回 undefined，由调用方按未配置处理。
 * 入参形状见 loadRawProjectConfig：传 RunEnv 即与本 run 其余消费方共用同一份 config.yml 读取。
 */
export function getGovernanceConfig(target: RunTarget): GovernanceConfig | undefined {
  try {
    const raw = loadRawProjectConfig(target);
    const governance = raw?.governance;
    if (governance === null || typeof governance !== 'object') return undefined;
    return governance as GovernanceConfig;
  } catch {
    return undefined;
  }
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

/**
 * 项目配置加载器
 */
export class ProjectConfigLoader {
  private env: RunEnv;
  private projectPath: string;
  private config: ProjectConfig;

  /**
   * @param target 项目根路径，或本 run 已构造的运行级观察面（ADR-0023 决策 2）
   *   传观察面时 config.yml 与本 run 其余消费方共用同一份读取；传路径 = 自造一枚一次性观察面
   */
  constructor(target?: RunTarget) {
    this.env = resolveRunEnv(target);
    this.projectPath = this.env.projectPath;
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * 加载项目配置（run 内 memo 在观察面上，同一份解析结果供全部消费方共用）
   */
  load(): ProjectConfig {
    const raw = this.env.rawConfig();
    if (raw) {
      this.config = { ...DEFAULT_CONFIG, ...(raw as Partial<ProjectConfig>) };
    }
    return this.config;
  }

  /**
   * 合并内置约束（生效集完整链路，ADR-0029）
   *
   * 合并顺序：内置 → preset 裁剪 → config.yml `constraints.<id>.enabled:false` 删除。
   *
   * config.yml 中未知约束 id（如已移除约束的禁用残留）静默忽略，
   * 记录在结果 unknownIds 中供诊断。
   *
   * @param options.preset 覆盖 config.yml 的 preset（CLI --preset 用）；
   *   未知预设名回落 standard + stderr 警告
   */
  mergeConstraints(options?: { preset?: string }): MergedConstraintsConfig {
    // 0. preset 裁剪（strict 是 standard 的别名；未知名回落 standard）
    const presetName = options?.preset ?? this.config.preset ?? 'standard';
    let preset = PRESETS_BY_NAME[presetName];
    if (!preset) {
      console.error(`[harness] 未知预设 "${presetName}"，已回落 standard`);
      preset = STANDARD_PRESET;
    }
    // preset 按 severity 分键；展开为「id → 是否启用」的单桶视图
    const bySeverity = (severity: 'error' | 'warning'): Record<string, Constraint> =>
      Object.fromEntries(Object.entries(CONSTRAINTS).filter(([, c]) => c.severity === severity));
    const pick = (
      source: Record<string, Constraint>,
      ids: string[] | null
    ): Record<string, Constraint> => {
      if (ids === null) return { ...source };
      const filtered: Record<string, Constraint> = {};
      for (const id of ids) {
        if (source[id]) filtered[id] = source[id];
      }
      return filtered;
    };
    const presetDisabled = (
      source: Record<string, Constraint>,
      ids: string[] | null
    ): string[] => (ids === null ? [] : Object.keys(source).filter(id => !ids.includes(id)));

    const errorConstraints = bySeverity('error');
    const warningConstraints = bySeverity('warning');

    const unknownIds: string[] = [];
    const result: MergedConstraintsConfig = {
      constraints: {
        ...pick(errorConstraints, preset.errors),
        ...pick(warningConstraints, preset.warnings),
      },
      disabled: [
        ...presetDisabled(errorConstraints, preset.errors),
        ...presetDisabled(warningConstraints, preset.warnings),
      ],
      unknownIds,
    };

    // 1. 处理启用/禁用配置（未知 id 静默忽略，记录供诊断）
    if (this.config.constraints) {
      const knownIds = new Set(Object.keys(CONSTRAINTS));
      const filtered = filterEnabledEntries(knownIds, this.config.constraints);
      unknownIds.push(...filtered.unknownIds);
      for (const constraintId of filtered.disabledIds) {
        result.disabled.push(constraintId);
        delete result.constraints[constraintId];
      }
    }

    return result;
  }

  /**
   * 获取当前配置
   */
  getConfig(): ProjectConfig {
    return this.config;
  }

  /**
   * 检查是否有自定义配置
   */
  hasCustomConfig(): boolean {
    return this.config.constraints !== undefined && Object.keys(this.config.constraints).length > 0;
  }
}
