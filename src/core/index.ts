/**
 * 核心模块导出
 */

// 约束系统（三层：Iron Laws / Guidelines / Tips）

export * from './constraints';

export * from './validators';
export * from './session';

// Spec 验证器
export { SpecValidator } from './spec/validator';
export type {
  SpecValidatorConfig,
  SpecValidationResult,
  BatchSpecValidationResult,
  SpecSchemaDefinition,
  SpecType,
} from '../types/spec';

// 项目配置加载器
export * from './project-config-loader';

// 生效约束集（ADR-0001：唯一生效集来源）
export * from './effective-constraints';