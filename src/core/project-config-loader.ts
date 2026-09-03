/**
 * 项目配置加载器
 *
 * 加载 .harness/config.yml 和 .harness/custom-constraints.yml
 * 合并内置约束和项目自定义约束
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { Constraint, ConstraintTrigger } from '../types/constraint';
import type {
  ProjectConfig,
  CustomConstraintDefinition,
  MergedConstraintsConfig,
  CapabilitiesConfig,
  GovernanceConfig,
} from '../types/project-config';
import { IRON_LAWS, GUIDELINES, PROMPTS } from './constraints/definitions';
import { PRESETS_BY_NAME, STANDARD_PRESET } from '../presets';
import { filterEnabledEntries } from './effective-set';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ProjectConfig = {
  preset: 'standard',
  custom_constraints_file: 'custom-constraints.yml',
};

/**
 * config.yml 原始解析结果的进程级缓存（工单 16）
 *
 * 键为解析后的项目路径，条目带 mtimeMs+size 指纹：文件未变则直接复用，
 * 避免单次 harness check 内多处读取者重复 yaml 解析；文件变更自动失效。
 */
const rawConfigCache = new Map<string, { mtimeMs: number; size: number; raw: Record<string, unknown> }>();

/**
 * 读取并解析 .harness/config.yml（进程级 memoize）
 *
 * 文件不存在时返回 undefined；解析失败向上抛出（由各调用方自行兜底）。
 */
export function loadRawProjectConfig(projectPath: string): Record<string, unknown> | undefined {
  const key = path.resolve(projectPath);
  const configPath = path.join(key, '.harness', 'config.yml');

  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(configPath);
  } catch {
    stat = undefined;
  }
  // 文件缺失，或 stat 不可用（如测试 mock）且文件不存在 → 无配置
  if (!stat?.mtimeMs && !fs.existsSync(configPath)) {
    rawConfigCache.delete(key);
    return undefined;
  }

  // stat 指纹可用时走缓存;不可用则每次直读(不缓存,避免脏数据)
  if (stat?.mtimeMs !== undefined) {
    const cached = rawConfigCache.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.raw;
    }
  }

  const loaded = yaml.load(fs.readFileSync(configPath, 'utf-8')) ?? {};
  const raw = loaded as Record<string, unknown>;
  if (stat?.mtimeMs !== undefined) {
    rawConfigCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, raw });
  }
  return raw;
}

/**
 * CAPABILITIES.md 登记模式（governance.capabilities.mode）
 */
export type CapabilitiesMode = NonNullable<CapabilitiesConfig['mode']>;

/**
 * 读取 governance 段（全仓唯一手写钻取点，工单 84）
 *
 * 基于 loadRawProjectConfig 的进程级 memoize，不引入第二次 yaml 解析。
 * 配置缺失 / 解析失败 / 形状不符时返回 undefined，由调用方按未配置处理。
 */
export function getGovernanceConfig(projectPath: string): GovernanceConfig | undefined {
  try {
    const raw = loadRawProjectConfig(projectPath);
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
export function resolveContextFiles(projectPath: string): ContextFilesResolution {
  const contextFiles = getGovernanceConfig(projectPath)?.context_files;
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
export function getCapabilitiesMode(projectPath: string): CapabilitiesMode {
  const mode = getGovernanceConfig(projectPath)?.capabilities?.mode;
  if (mode === 'file' || mode === 'module' || mode === 'listing') return mode;
  return 'file';
}

/**
 * 项目配置加载器
 */
export class ProjectConfigLoader {
  private projectPath: string;
  private config: ProjectConfig;
  private customConstraints: Record<string, CustomConstraintDefinition>;

  constructor(projectPath?: string) {
    this.projectPath = projectPath || process.cwd();
    this.config = { ...DEFAULT_CONFIG };
    this.customConstraints = {};
  }

  /**
   * 加载项目配置
   */
  load(): ProjectConfig {
    // 1. 加载主配置（经进程级 memoize，避免重复 yaml 解析）
    const raw = loadRawProjectConfig(this.projectPath);
    if (raw) {
      this.config = { ...DEFAULT_CONFIG, ...(raw as Partial<ProjectConfig>) };
    }

    // 2. 加载自定义约束
    this.loadCustomConstraints();

    return this.config;
  }

  /**
   * 加载自定义约束
   */
  private loadCustomConstraints(): void {
    // 方式 1：从单独文件加载
    if (this.config.custom_constraints_file) {
      const customPath = path.join(
        this.projectPath,
        '.harness',
        this.config.custom_constraints_file
      );
      if (fs.existsSync(customPath)) {
        const content = fs.readFileSync(customPath, 'utf-8');
        const loaded = yaml.load(content) as {
          custom_constraints?: Record<string, CustomConstraintDefinition>;
        };
        if (loaded.custom_constraints) {
          this.customConstraints = { ...this.customConstraints, ...loaded.custom_constraints };
        }
      }
    }

    // 方式 2：从主配置文件中加载
    if (this.config.custom_constraints) {
      this.customConstraints = { ...this.customConstraints, ...this.config.custom_constraints };
    }
  }

  /**
   * 合并内置约束和自定义约束（ADR-0001 生效集完整链路）
   *
   * 合并顺序：内置 → preset 裁剪 → config.yml `constraints.<id>.enabled:false`
   * 删除（对内置与 custom 同效）→ custom-constraints 追加
   * （禁用/已退役的 custom 不追加）→ scenes 过滤
   * （带 appliesTo 的 prompt 仅当 scenes 交集非空时保留）。
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

    const unknownIds: string[] = [];
    const result: MergedConstraintsConfig = {
      ironLaws: pick(IRON_LAWS, preset.ironLaws),
      guidelines: pick(GUIDELINES, preset.guidelines),
      prompts: pick(PROMPTS, preset.prompts),
      disabled: [
        ...presetDisabled(IRON_LAWS, preset.ironLaws),
        ...presetDisabled(GUIDELINES, preset.guidelines),
        ...presetDisabled(PROMPTS, preset.prompts),
      ],
      custom: [],
      unknownIds,
    };

    // 1. 处理启用/禁用配置（未知 id 静默忽略，记录供诊断）
    if (this.config.constraints) {
      const knownIds = new Set([
        ...Object.keys(IRON_LAWS),
        ...Object.keys(GUIDELINES),
        ...Object.keys(PROMPTS),
        ...Object.keys(this.customConstraints),
      ]);
      const filtered = filterEnabledEntries(knownIds, this.config.constraints, {
        onUnknownId: 'collect',
      });
      unknownIds.push(...filtered.unknownIds);
      for (const constraintId of filtered.disabledIds) {
        result.disabled.push(constraintId);
        // 从对应层级中移除
        delete result.ironLaws[constraintId];
        delete result.guidelines[constraintId];
        delete result.prompts![constraintId];
      }
    }

    // 2. 添加自定义约束（config.yml 禁用的 id 不追加：step 1 已将其
    // 收集进 disabled，custom 在 step 1 时尚未入桶，须在此兜底跳过；
    // 条目带 retired 元数据的同样不追加——studio#82 D6 退役落点在条目自身）
    for (const [id, customDef] of Object.entries(this.customConstraints)) {
      if (result.disabled.includes(id) || customDef.retired) {
        continue;
      }
      const constraint = this.toConstraint(customDef, id);

      result.custom.push(id);

      const level = customDef.level || 'guideline';
      switch (level) {
        case 'iron_law':
          result.ironLaws[id] = constraint;
          break;
        case 'guideline':
          result.guidelines[id] = constraint;
          break;
        case 'prompt':
          result.prompts![id] = constraint;
          break;
      }
    }

    // 3. scenes 过滤（ADR-0001）：带 appliesTo 标签的 prompt 仅当项目 scenes
    // 与其交集非空时保留；无 appliesTo 的条目不受影响。缺省 scenes=[] 即
    // 场景专属 prompt 默认不进入生效集。
    const scenes = this.config.scenes ?? [];
    for (const [id, constraint] of Object.entries(result.prompts!)) {
      if (
        constraint.appliesTo &&
        constraint.appliesTo.length > 0 &&
        !constraint.appliesTo.some(scene => scenes.includes(scene))
      ) {
        delete result.prompts![id];
      }
    }

    return result;
  }

  /**
   * 将自定义约束定义转换为 Constraint
   *
   * kind 推导（ADR-0001）：自定义约束没有注册表中的 checker，统一归为
   * kind='prompt'（不执行 checker，check() 短路通过），level 仅决定其所在
   * 桶与严重性行为，保持与历史"未注册默认通过"相同的执行语义。
   */
  private toConstraint(def: CustomConstraintDefinition, defaultId: string): Constraint {
    const level = def.level || 'guideline';
    return {
      id: def.id || defaultId,
      kind: 'prompt',
      level,
      rule: def.rule || '',
      message: def.message || '',
      trigger: (def.trigger || 'manual') as ConstraintTrigger | ConstraintTrigger[],
      description: def.description,
      promptInjection: def.promptInjection,
      enabled: def.enabled !== false,
      enforcement: 'custom',
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ProjectConfig {
    return this.config;
  }

  /**
   * 获取自定义约束
   */
  getCustomConstraints(): Record<string, CustomConstraintDefinition> {
    return this.customConstraints;
  }

  /**
   * 检查约束是否启用
   */
  isConstraintEnabled(constraintId: string): boolean {
    // 1. 检查是否在禁用列表
    if (this.config.constraints?.[constraintId]?.enabled === false) {
      return false;
    }

    // 2. 检查自定义约束是否禁用
    if (this.customConstraints[constraintId]?.enabled === false) {
      return false;
    }

    return true;
  }

  /**
   * 获取约束来源
   */
  getConstraintSource(constraintId: string): 'built-in' | 'custom' | 'disabled' {
    if (this.config.constraints?.[constraintId]?.enabled === false) {
      return 'disabled';
    }
    if (this.customConstraints[constraintId]) {
      return 'custom';
    }
    return 'built-in';
  }

  /**
   * 检查是否有自定义配置
   */
  hasCustomConfig(): boolean {
    return (
      Object.keys(this.customConstraints).length > 0 ||
      (this.config.constraints !== undefined && Object.keys(this.config.constraints).length > 0)
    );
  }
}
