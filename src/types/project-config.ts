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
}

/**
 * 文档新鲜度配置
 *
 * 配置驱动的文档新鲜度检查。每个检查类型是纯文件系统操作，零 LLM 调用。
 */
export interface DocFreshnessConfig {
  /** 是否启用文档新鲜度检查 */
  enabled?: boolean;
  /** 检查列表 */
  checks?: DocFreshnessCheck[];
}

export type DocFreshnessCheck =
  | ChangelogVersionCheck
  | ContextDocsCheck
  | DocDirCheck
  | DocRegexCountCheck;

/** CHANGELOG 版本 vs package.json 版本一致性 */
export interface ChangelogVersionCheck {
  type: 'changelog_version';
  /** CHANGELOG 文件路径（默认: CHANGELOG.md） */
  changelog?: string;
  /** package.json 路径（默认: package.json） */
  package_json?: string;
}

/** 关键目录是否有 CONTEXT.md */
export interface ContextDocsCheck {
  type: 'context_docs';
  /** 需要检查的目录列表（默认: governance.context_files.required_dirs） */
  dirs?: string[];
  /** 文档名称（默认: CONTEXT.md） */
  doc_name?: string;
}

/** 文档中的目录表 vs 实际目录双向检查 */
export interface DocDirCheck {
  type: 'doc_dir_check';
  /** 文档文件路径 */
  doc: string;
  /** 章节标题（如 "Key Subsystems"） */
  section: string;
  /** 目录提取正则（默认: `([^`]+)`，匹配反引号内的目录路径） */
  dir_pattern?: string;
  /** 反向检查时要跳过的目录 */
  exclude?: string[];
  /** 跳过反向检查（fs→doc），仅做 doc→fs */
  skip_reverse_check?: boolean;
}

/** 文档中正则计数 vs 文件系统实际计数 */
export interface DocRegexCountCheck {
  type: 'doc_regex_count';
  /** 文档文件路径 */
  doc: string;
  /** 人类可读标签（错误消息用） */
  label: string;
  /** 正则模式，需包含 (\d+) 捕获组 */
  pattern: string;
  /** 实际计数的获取方式 */
  actual: DirCountActual | GrepCountActual | ConstCountActual;
}

/** 通过扫描目录获取实际计数 */
export interface DirCountActual {
  kind: 'dir_count';
  /** 目录路径 */
  path: string;
  /** 文件扩展名过滤（如 ".ts"） */
  extension?: string;
  /** 排除的文件/目录名 */
  exclude?: string[];
}

/** 通过 grep 匹配获取实际计数 */
export interface GrepCountActual {
  kind: 'grep_count';
  /** glob 模式匹配文件 */
  glob: string;
  /** 在每个匹配文件中计数的正则 */
  pattern: string;
}

/** 通过常量值获取实际计数（用于内存中的对象计数，如约束数量） */
export interface ConstCountActual {
  kind: 'const_count';
  value: number;
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

  /** 文档新鲜度检查配置 */
  doc_freshness?: DocFreshnessConfig;

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