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
} from '../types/project-config';
import { IRON_LAWS, GUIDELINES, TIPS } from './constraints/definitions';

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
 * 读取 governance.capabilities.mode（缺省 'file'，向后兼容）
 *
 * 配置缺失/解析失败/取值非法时一律回落 'file'。
 */
export function getCapabilitiesMode(projectPath: string): CapabilitiesMode {
  try {
    const raw = loadRawProjectConfig(projectPath);
    const governance = raw?.governance as Record<string, unknown> | undefined;
    const capabilities = governance?.capabilities as Record<string, unknown> | undefined;
    const mode = capabilities?.mode;
    if (mode === 'file' || mode === 'module' || mode === 'listing') return mode;
  } catch {
    // 配置缺失或解析失败，按默认 file 处理
  }
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
   * 合并内置约束和自定义约束
   */
  mergeConstraints(): MergedConstraintsConfig {
    const result: MergedConstraintsConfig = {
      ironLaws: { ...IRON_LAWS },
      guidelines: { ...GUIDELINES },
      tips: { ...TIPS },
      disabled: [],
      custom: [],
    };

    // 1. 处理启用/禁用配置
    if (this.config.constraints) {
      for (const [constraintId, config] of Object.entries(this.config.constraints)) {
        if (config.enabled === false) {
          result.disabled.push(constraintId);
          // 从对应层级中移除
          delete result.ironLaws[constraintId];
          delete result.guidelines[constraintId];
          delete result.tips[constraintId];
        }
      }
    }

    // 2. 添加自定义约束
    for (const [id, customDef] of Object.entries(this.customConstraints)) {
      const extendExceptions = customDef.extend_exceptions;
      const isExtendOnly =
        !!extendExceptions && extendExceptions.length > 0 &&
        !customDef.rule &&
        !customDef.exceptions;

      if (isExtendOnly) {
        const builtIn = this.findBuiltInConstraint(id, result);
        if (builtIn) {
          const constraint = { ...builtIn };
          constraint.exceptions = [
            ...(builtIn.exceptions || []),
            ...extendExceptions!,
          ];
          if (result.ironLaws[id]) result.ironLaws[id] = constraint;
          if (result.guidelines[id]) result.guidelines[id] = constraint;
          if (result.tips[id]) result.tips[id] = constraint;
          continue;
        }
      }

      const constraint = this.toConstraint(customDef, id);

      if (extendExceptions && extendExceptions.length > 0) {
        const builtIn = this.findBuiltInConstraint(id, result);
        constraint.exceptions = [
          ...(builtIn?.exceptions || []),
          ...(customDef.exceptions || []),
          ...extendExceptions,
        ];
      }

      result.custom.push(id);

      const level = customDef.level || 'guideline';
      switch (level) {
        case 'iron_law':
          result.ironLaws[id] = constraint;
          break;
        case 'guideline':
          result.guidelines[id] = constraint;
          break;
        case 'tip':
          result.tips[id] = constraint;
          break;
      }
    }

    return result;
  }

  /**
   * 在合并结果中查找内置约束
   */
  private findBuiltInConstraint(
    id: string,
    merged: MergedConstraintsConfig
  ): Constraint | undefined {
    return merged.ironLaws[id] || merged.guidelines[id] || merged.tips[id];
  }

  /**
   * 将自定义约束定义转换为 Constraint
   */
  private toConstraint(def: CustomConstraintDefinition, defaultId: string): Constraint {
    return {
      id: def.id || defaultId,
      level: def.level || 'guideline',
      rule: def.rule || '',
      message: def.message || '',
      trigger: (def.trigger || 'manual') as ConstraintTrigger | ConstraintTrigger[],
      exceptions: def.exceptions,
      description: def.description,
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
