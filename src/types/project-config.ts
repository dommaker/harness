/**
 * 项目级自定义约束配置
 *
 * 允许项目定义自己的约束，扩展或覆盖 harness 内置约束
 */

import type { Constraint, ConstraintLevel } from './constraint';

/**
 * 自定义约束定义
 */
export interface CustomConstraintDefinition {
  /** 约束 ID */
  id: string;

  /** 约束层级（扩展例外时可省略，自动使用内置约束层级） */
  level?: ConstraintLevel;

  /** 约束规则（扩展例外时可省略） */
  rule?: string;

  /** 约束消息（扩展例外时可省略） */
  message?: string;

  /** 触发条件（扩展例外时可省略） */
  trigger?: string | string[];

  /** 例外条件（可选，完全覆盖内置例外） */
  exceptions?: string[];

  /** 扩展例外（可选，追加到内置例外） */
  extend_exceptions?: string[];

  /** 描述（可选） */
  description?: string;

  /** 是否启用（可选，默认 true） */
  enabled?: boolean;
}

/**
 * 文档同步配置
 */
export interface DocsSyncConfig {
  /** 同步命令（默认: harness sync-docs） */
  sync_command?: string;
  /** CI 中是否检查文档新鲜度 */
  check_on_ci?: boolean;
  /** 需要同步的文件列表 */
  files?: string[];
}

/**
 * CONTEXT.md 配置
 */
export interface ContextFilesConfig {
  /** 是否启用 CONTEXT.md 检查 */
  enabled?: boolean;
  /** 必须包含 CONTEXT.md 的目录列表 */
  required_dirs?: string[];
}

/**
 * CHANGELOG 配置
 */
export interface ChangelogConfig {
  /** 格式 */
  format?: 'keep-a-changelog' | 'conventional';
  /** 是否自动生成条目（sync-docs 辅助） */
  auto_append?: boolean;
}

/**
 * 测试治理配置
 */
export interface TestingGovernanceConfig {
  /** 新代码必须有测试（Guideline 提醒） */
  test_first?: boolean;
  /** 覆盖率阈值 */
  coverage_threshold?: number;
  /** 增量覆盖率检查（只检查新增代码） */
  incremental_coverage?: boolean;
}

/**
 * 治理配置
 */
export interface GovernanceConfig {
  /** 治理级别 */
  level?: 'minimal' | 'standard' | 'strict';

  /** 文档同步 */
  docs?: DocsSyncConfig;

  /** CONTEXT.md 配置 */
  context_files?: ContextFilesConfig;

  /** CHANGELOG 配置 */
  changelog?: ChangelogConfig;

  /** 测试治理 */
  testing?: TestingGovernanceConfig;
}

/**
 * 项目配置
 */
export interface ProjectConfig {
  /** harness 版本 */
  harness?: {
    version?: string;
  };

  /** 使用预设 */
  preset?: 'strict' | 'standard' | 'relaxed';

  /** 治理配置 */
  governance?: GovernanceConfig;

  /** 内置约束启用/禁用配置 */
  constraints?: Record<string, { enabled?: boolean }>;

  /** 自定义约束文件路径 */
  custom_constraints_file?: string;

  /** 自定义约束（直接定义） */
  custom_constraints?: Record<string, CustomConstraintDefinition>;

  /** Spec 验证配置 */
  spec?: {
    /** 是否启用 Spec 验证 */
    enabled?: boolean;
    /** Schema 路径（项目定义） */
    schemaPath?: string;
    /** 要验证的文件模式 */
    files?: string[];
    /** 验证失败的级别 */
    failureLevel?: 'error' | 'warning';
  };
}

/**
 * 完整的约束配置（合并内置 + 自定义）
 */
export interface MergedConstraintsConfig {
  /** Iron Laws（合并后） */
  ironLaws: Record<string, Constraint>;

  /** Guidelines（合并后） */
  guidelines: Record<string, Constraint>;

  /** Tips（合并后） */
  tips: Record<string, Constraint>;

  /** 禁用的约束 ID */
  disabled: string[];

  /** 自定义约束 ID */
  custom: string[];
}