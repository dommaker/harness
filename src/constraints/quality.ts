/**
 * 质量层约束（可退化）
 *
 * 这些约束会随模型能力提升逐步退化：
 * - Iron Law → Guideline → Tip → 移除
 * - 退化由拦截率数据驱动
 */

import type { LayeredConstraint } from './types';

export const QUALITY_CONSTRAINTS: Record<string, LayeredConstraint> = {
  no_self_approval: {
    id: 'no_self_approval',
    rule: 'NO SELF APPROVAL WITHOUT TEST EVIDENCE',
    message: '禁止自评通过，必须提供测试证据',
    level: 'iron_law',
    trigger: 'task_completion_claim',
    enforcement: 'passes-gate',
    description: '任务完成声明必须基于真实测试结果。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'guideline',
      interceptRateThreshold: 5,
      reason: '模型自评能力提升，拦截率持续下降',
      rollbackable: true,
    },
  },

  no_test_simplification: {
    id: 'no_test_simplification',
    rule: 'NO SIMPLIFYING TESTS TO AVOID DIFFICULTY',
    message: '禁止简化测试绕过困难',
    level: 'iron_law',
    trigger: 'test_creation',
    enforcement: 'full-test-coverage',
    description: '遇到测试困难时不能简化或跳过测试。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'guideline',
      interceptRateThreshold: 5,
      reason: '模型测试编写能力提升',
      rollbackable: true,
    },
  },

  incremental_progress: {
    id: 'incremental_progress',
    rule: 'ONE TASK PER SESSION',
    message: '禁止一次做多个任务',
    level: 'iron_law',
    trigger: 'feature_completion_claim',
    enforcement: 'single-task-check',
    description: '一个 session 只处理一个任务，避免 one-shotting。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'guideline',
      interceptRateThreshold: 10,
      reason: '模型长上下文能力提升，可处理更大任务',
      rollbackable: true,
    },
  },

  no_any_type: {
    id: 'no_any_type',
    rule: 'AVOID ANY TYPE, USE UNKNOWN OR SPECIFIC TYPES',
    message: '避免 any 类型',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'type-safe',
    description: 'TypeScript 代码中应避免使用 any 类型。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'tip',
      interceptRateThreshold: 8,
      reason: '模型类型推断能力持续改善',
      rollbackable: true,
    },
  },

  simplest_solution_first: {
    id: 'simplest_solution_first',
    rule: 'CHECK LOCAL/SIMPLE OPTIONS BEFORE REMOTE/COMPLEX',
    message: '先检查本地/简单方案',
    level: 'guideline',
    trigger: ['feature_development', 'module_extension', 'code_implementation'],
    enforcement: 'check-local-first',
    description: '实现功能时必须按顺序检查简单方案。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'tip',
      interceptRateThreshold: 8,
      reason: '模型架构选择能力提升',
      rollbackable: true,
    },
  },

  no_code_without_test: {
    id: 'no_code_without_test',
    rule: 'PRODUCTION LOGIC CODE MUST HAVE TESTS FIRST',
    message: '业务逻辑代码必须先写测试',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'tdd-cycle',
    description: '业务逻辑代码必须先写测试。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'tip',
      reason: '模型自发编写测试的能力提升',
      rollbackable: false,
    },
  },

  no_creation_without_reuse_check: {
    id: 'no_creation_without_reuse_check',
    rule: 'NO NEW CAPABILITIES WITHOUT REUSE CHECK FIRST',
    message: '创建新能力前必须检查复用',
    level: 'guideline',
    trigger: [
      'step_creation', 'tool_creation', 'workflow_creation',
      'module_creation', 'module_extension', 'feature_development',
    ],
    enforcement: 'reuse-first',
    description: '创建新能力前必须先执行复用检查。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'guideline',
      interceptRateThreshold: 5,
      reason: '转型为知识复用检查',
      rollbackable: true,
    },
  },

  no_fix_without_root_cause: {
    id: 'no_fix_without_root_cause',
    rule: 'NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST',
    message: '复杂 bug 必须先调查根本原因',
    level: 'guideline',
    trigger: 'bug_fix_attempt',
    enforcement: 'debug-systematic',
    description: '在尝试修复 bug 之前，按复杂度区分调查要求。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'guideline',
      reason: '转型为知识约束（因果链要求）',
      rollbackable: true,
    },
  },

  capability_sync: {
    id: 'capability_sync',
    rule: 'CODE CHANGES MUST UPDATE CAPABILITIES.MD',
    message: '核心模块变更必须同步功能清单',
    level: 'guideline',
    trigger: ['module_creation', 'module_modification', 'module_deletion', 'module_extension'],
    enforcement: 'update-capabilities',
    description: '核心模块变更必须同步功能清单。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'guideline',
      reason: '转型为知识同步检查',
      rollbackable: true,
    },
  },

  no_simplification_without_approval: {
    id: 'no_simplification_without_approval',
    rule: 'NO SIMPLIFYING LOGIC WITHOUT USER APPROVAL',
    message: '禁止砍功能，合理重构除外',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'preserve-complexity',
    description: '不能为了赶进度砍掉必要功能。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'tip',
      reason: '模型对需求完整性的理解提升',
      rollbackable: true,
    },
  },

  design_decision_requires_discussion: {
    id: 'design_decision_requires_discussion',
    rule: 'DESIGN DECISIONS MUST BE DISCUSSED BEFORE IMPLEMENTATION',
    message: '设计决策类任务需先讨论方案再实现',
    level: 'guideline',
    trigger: ['design_request', 'architecture_change', 'feature_development'],
    enforcement: 'require-discussion',
    description: '架构决策必须沉淀为 decision 类型知识。',
    layer: 'quality',
    deprecationStatus: 'active',
    deprecationSchedule: {
      targetLevel: 'guideline',
      reason: '转型为知识沉淀要求',
      rollbackable: true,
    },
  },

  no_skill_without_test: {
    id: 'no_skill_without_test',
    rule: 'NO SKILL WITHOUT A FAILING TEST FIRST',
    message: '创建技能前必须先定义测试场景',
    level: 'guideline',
    trigger: 'skill_creation',
    enforcement: 'skill-test-scenario',
    description: '创建新的 agent 技能之前，必须先定义测试场景。',
    layer: 'quality',
    deprecationStatus: 'active',
  },

  test_coverage_required: {
    id: 'test_coverage_required',
    rule: 'TEST COVERAGE MUST MEET REQUIREMENTS',
    message: '测试覆盖率必须达到要求',
    level: 'guideline',
    trigger: 'task_completion_claim',
    enforcement: 'check-coverage',
    description: '提交代码前，测试覆盖率必须达到项目要求。',
    layer: 'quality',
    deprecationStatus: 'active',
  },

  no_coverage_decrease: {
    id: 'no_coverage_decrease',
    rule: 'COVERAGE MUST NOT DECREASE ON NEW COMMITS',
    message: '新提交不能降低测试覆盖率',
    level: 'guideline',
    trigger: 'commit',
    enforcement: 'coverage-gate',
    description: '每次提交代码时，测试覆盖率不能低于上一次提交。',
    layer: 'quality',
    deprecationStatus: 'active',
  },

  readme_required: {
    id: 'readme_required',
    rule: 'NEW MODULES SHOULD HAVE README',
    message: '建议为新模块创建 README',
    level: 'tip',
    trigger: 'module_creation',
    enforcement: 'create-readme',
    description: '创建新模块时建议同时创建 README.md。',
    layer: 'quality',
    deprecationStatus: 'active',
  },

  doc_required_for_public_api: {
    id: 'doc_required_for_public_api',
    rule: 'PUBLIC API SHOULD HAVE DOCUMENTATION',
    message: '建议为公共 API 添加文档注释',
    level: 'tip',
    trigger: 'export_change',
    enforcement: 'add-docs',
    description: '所有导出的函数、类、接口建议添加 JSDoc 注释。',
    layer: 'quality',
    deprecationStatus: 'active',
  },
};

export function getQualityConstraints(): LayeredConstraint[] {
  return Object.values(QUALITY_CONSTRAINTS);
}
