/**
 * 安全层约束（永久保留）
 *
 * 这些约束是模型无关的安全底线，不随模型能力提升而退化：
 * - CommandGate：命令黑名单
 * - SecurityGate：敏感文件审计
 * - 跨项目接口一致性
 * - 架构规则引擎
 */

import type { LayeredConstraint } from './types';

export const SAFETY_CONSTRAINTS: Record<string, LayeredConstraint> = {
  no_bypass_checkpoint: {
    id: 'no_bypass_checkpoint',
    rule: 'NO BYPASSING CHECKPOINTS',
    message: '禁止跳过检查点验证',
    level: 'iron_law',
    trigger: 'step_execution',
    enforcement: 'checkpoint-required',
    description: '所有检查点必须通过，不能跳过验证步骤。检查点是质量的最后一道防线。',
    layer: 'safety',
    deprecationStatus: 'active',
    permanent: true,
  },

  CommandGate: {
    id: 'CommandGate',
    rule: 'BLOCKED COMMANDS CANNOT BE EXECUTED',
    message: '黑名单命令禁止执行',
    level: 'iron_law',
    trigger: 'workflow_execution',
    enforcement: 'command-blacklist',
    description: 'rm -rf /、mkfs、fork bomb 等危险命令永远不能执行。',
    layer: 'safety',
    deprecationStatus: 'active',
    permanent: true,
  },

  SecurityGate: {
    id: 'SecurityGate',
    rule: 'SENSITIVE FILE ACCESS MUST BE AUDITED',
    message: '敏感文件访问必须审计',
    level: 'iron_law',
    trigger: 'file_modification',
    enforcement: 'security-audit',
    description: '.env、密钥文件、凭证文件的访问必须留审计日志。',
    layer: 'safety',
    deprecationStatus: 'active',
    permanent: true,
  },

  cross_project_interface_consistency: {
    id: 'cross_project_interface_consistency',
    rule: 'CROSS-PROJECT INTERFACES MUST REMAIN CONSISTENT',
    message: '跨项目接口必须保持一致',
    level: 'iron_law',
    trigger: ['api_change', 'module_modification'],
    enforcement: 'cross-project-check',
    description: '多仓库协调问题，不是模型能力问题，必须永久保留。',
    layer: 'safety',
    deprecationStatus: 'active',
    permanent: true,
  },

  architecture_rule_engine: {
    id: 'architecture_rule_engine',
    rule: 'ARCHITECTURE BOUNDARY RULES MUST BE ENFORCED',
    message: '架构边界规则必须强制执行',
    level: 'iron_law',
    trigger: ['module_creation', 'module_extension', 'code_implementation'],
    enforcement: 'architecture-check',
    description: '团队架构边界的硬约束，如 forbidden-pattern 等。',
    layer: 'safety',
    deprecationStatus: 'active',
    permanent: true,
  },

  verify_external_capability: {
    id: 'verify_external_capability',
    rule: 'VERIFY EXTERNAL CAPABILITY BEFORE IMPLEMENTATION',
    message: '外部依赖能力必须先验证',
    level: 'iron_law',
    trigger: 'external_api_design',
    enforcement: 'capability-verification',
    description: '实现方案依赖外部系统的未确认能力时，必须先验证。',
    layer: 'safety',
    deprecationStatus: 'active',
    permanent: true,
  },

  no_implementation_without_requirement_review: {
    id: 'no_implementation_without_requirement_review',
    rule: 'REVIEW IMPLEMENTATION AGAINST REQUIREMENTS',
    message: '实现后必须对比需求验证',
    level: 'iron_law',
    trigger: 'implementation_complete',
    enforcement: 'requirement-review',
    description: '实现完成后，必须对比原始需求进行验证。',
    layer: 'safety',
    deprecationStatus: 'active',
    permanent: true,
  },
};

export function getSafetyConstraints(): LayeredConstraint[] {
  return Object.values(SAFETY_CONSTRAINTS);
}
