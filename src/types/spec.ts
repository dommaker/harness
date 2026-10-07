/**
 * Spec 验证类型
 * 
 * 框架提供验证机制，项目定义自己的 Spec Schema
 */

/**
 * Spec 类型
 */
export type SpecType = 'architecture' | 'module' | 'api' | 'custom';

/**
 * Spec 验证错误
 */
export interface SpecValidationError {
  /** 错误路径 */
  path: string;
  /** 错误消息 */
  message: string;
  /** 严重程度 */
  severity: 'error' | 'warning';
}

/**
 * Spec 验证结果
 */
export interface SpecValidationResult {
  /** 是否通过 */
  valid: boolean;
  /** 文件路径 */
  file: string;
  /** Spec 类型 */
  type: SpecType;
  /** 错误列表 */
  errors: SpecValidationError[];
  /** 警告列表 */
  warnings: SpecValidationError[];
  /** 指标（可选） */
  metrics?: Record<string, number>;
}

/**
 * Spec 验证配置
 */
export interface SpecValidatorConfig {
  /** Schema 路径（项目定义） */
  schemaPath: string;
  /** 要验证的文件模式 */
  files: string[];
}

/**
 * Schema 加载器函数类型
 * 
 * 项目可以自定义 Schema 加载逻辑
 */
export type SchemaLoader = (schemaPath: string) => Promise<SpecSchemaDefinition>;

/**
 * Schema 定义（通用接口）
 * 
 * 项目需要实现这个接口
 */
export interface SpecSchemaDefinition {
  /** Schema 名称 */
  name: string;
  /** Schema 版本 */
  version?: string;
  /** 验证函数 */
  validate: (content: string, filePath: string) => Promise<SpecValidationResult>;
}

/**
 * 批量验证结果
 */
export interface BatchSpecValidationResult {
  /** 总文件数 */
  total: number;
  /** 通过数 */
  passed: number;
  /** 失败数 */
  failed: number;
  /** 警告数 */
  warnings: number;
  /** 详细结果 */
  results: SpecValidationResult[];
}
