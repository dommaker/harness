/**
 * 失败处理模块
 *
 * 提供通用的错误分类和记录能力
 * 不包含业务逻辑
 */

// 路径常量与纯类型（正本 src/types/failure.ts；harness#137 删掉 ./types 兼容 shim，
// 本 barrel 直连正本并把星号改成显式清单——ADR-0003 的「对外给了什么」按名字可答）
export {
  DEFAULT_FAILURE_LOG_FILE,
} from '../types/failure';
export type {
  ErrorClassificationRule,
  FailureRecord,
  ClassificationResult,
} from '../types/failure';

// 运行时数据（enum 与默认分类表；正本 ./error-types，ADR-0040 Phase 3 自 types 移回）
export {
  ErrorType,
  FailureLevel,
  DEFAULT_CLASSIFICATION_RULES,
  DEFAULT_LEVEL_MAPPING,
} from './error-types';

// 分类器
export {
  ErrorClassifier,
  type ErrorClassifierConfig,
} from './classifier';

// 记录器
export {
  FailureRecorder,
  type FailureRecorderConfig,
} from './recorder';
