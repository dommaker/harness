/**
 * 项目级约束配置
 *
 * 允许项目启用/禁用 harness 内置约束（ADR-0029：项目自定义纯文本约束
 * 已随文本注入层关停一并退役，文本规则由项目手写治理段承接）
 */

import type { Constraint } from './constraint';

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
 * CAPABILITIES.md 登记模式配置
 */
export interface CapabilitiesConfig {
  /**
   * 登记模式：
   * - file：逐文件登记（默认，历史行为）
   * - module：模块级目录条目登记，按目录前缀覆盖判定
   * - listing：能力清单格式（计数行）的显式声明
   */
  mode?: 'file' | 'module' | 'listing';
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

  /** CAPABILITIES.md 登记模式配置 */
  capabilities?: CapabilitiesConfig;

  /** CHANGELOG 配置 */
  changelog?: ChangelogConfig;

  /** 文档新鲜度检查配置 */
  doc_freshness?: DocFreshnessConfig;

  /** 测试治理 */
  testing?: TestingGovernanceConfig;
}

/**
 * CI 平台（harness#143）：服务端门禁的接线目标
 *
 * 本地 hook 跑在推送者控制的机器上（`--no-verify` 可绕过），只能算自检；
 * 真正的门禁必须抢到服务端 CI 这个执行时机。取值域另含 `'none'`（不接线），
 * 那在本类型之外——命令层据此让 CI 站点干脆不进 plan，scaffold 只见有形状的平台。
 */
export type CiPlatform = 'github' | 'gitlab';

/**
 * CI 接线配置（config.yml `ci` 段，harness#143）
 *
 * `platform` 缺省 = `github`；`'none'` = 不落任何 CI 文件。旧配置无此段即 `github`，零迁移。
 */
export interface CiConfig {
  platform?: CiPlatform | 'none';
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

  /** CI 接线平台（harness#143，缺省 github） */
  ci?: CiConfig;

  /** 治理配置 */
  governance?: GovernanceConfig;

  /** 内置约束启用/禁用配置 */
  constraints?: Record<string, { enabled?: boolean }>;

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
 * 完整的约束配置（合并内置 + preset 裁剪 + config.yml 禁用）
 */
export interface MergedConstraintsConfig {
  /** 生效的约束（合并后，单桶；severity 在条目上） */
  constraints: Record<string, Constraint>;

  /** 禁用的约束 ID */
  disabled: string[];

  /**
   * config.yml `constraints.<id>` 中非内置的未知 id
   *
   * 例如禁用了已被本版移除的约束 id 的残留配置。生效集计算静默忽略，
   * 在此列出供诊断（lintEffectiveConfig / report）使用。
   * 可选以兼容手工构造 MergedConstraintsConfig 的历史调用方。
   */
  unknownIds?: string[];
}