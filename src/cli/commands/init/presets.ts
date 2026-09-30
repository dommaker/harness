/**
 * init 的预设数据表（Phase 3 自 init.ts 拆出，纯移位）
 *
 * preset 三档（strict/standard/relaxed）与治理预设（minimal/standard/strict），
 * 入口值域校验与装配共用同一份 GOVERNANCE_PRESETS 键集合（harness#156）。
 */

import type { GovernanceConfig } from '../../../types/project-config';

/**
 * 默认配置
 *
 * 只写有运行时消费者的字段：preset（ADR-0001 生效集链路由 mergeConstraints 消费）。
 * 历史模板里的 enabled / ironLaws.enforceErrors / ironLaws.warnWarnings /
 * validators.{checkpoint,passesGate,cso} 均为零消费者的死字段，不再写入；
 * strict/standard/relaxed 三档差异曾只存在于这些死字段上（实为两档），
 * 现在三档差异完全由 preset 键经生效集链路体现。
 */
const DEFAULT_CONFIG = {
  preset: 'standard',
};

/**
 * 预设配置
 */
export const PRESETS = {
  strict: {
    ...DEFAULT_CONFIG,
    preset: 'strict',
  },
  standard: {
    ...DEFAULT_CONFIG,
    preset: 'standard',
  },
  relaxed: {
    ...DEFAULT_CONFIG,
    preset: 'relaxed',
  },
};

/**
 * 治理预设（形状 = 写入 config.yml 的 governance 段，直接用类型正本）
 */
export const GOVERNANCE_PRESETS: Record<string, GovernanceConfig> = {
  minimal: {
    level: 'minimal',
    docs: {
      sync_command: 'harness sync-docs',
      check_on_ci: false,
      files: ['CAPABILITIES.md'],
    },
    context_files: {
      enabled: false,
      required_dirs: [],
    },
    changelog: {
      format: 'keep-a-changelog',
    },
    testing: {
      test_first: true,
      coverage_threshold: 85,
      incremental_coverage: false,
    },
  },
  standard: {
    level: 'standard',
    docs: {
      sync_command: 'harness sync-docs',
      check_on_ci: true,
      files: ['CAPABILITIES.md', 'README.md'],
    },
    context_files: {
      enabled: true,
      required_dirs: [],
    },
    changelog: {
      format: 'keep-a-changelog',
    },
    testing: {
      test_first: true,
      coverage_threshold: 85,
      incremental_coverage: false,
    },
  },
  strict: {
    level: 'strict',
    docs: {
      sync_command: 'harness sync-docs',
      check_on_ci: true,
      files: ['CAPABILITIES.md', 'README.md', 'CHANGELOG.md'],
    },
    context_files: {
      enabled: true,
      required_dirs: [],
    },
    changelog: {
      format: 'keep-a-changelog',
    },
    testing: {
      test_first: true,
      coverage_threshold: 85,
      incremental_coverage: true,
    },
  },
};
