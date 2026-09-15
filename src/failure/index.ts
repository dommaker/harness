/**
 * 失败处理模块
 *
 * 提供通用的错误分类和记录能力
 * 不包含业务逻辑
 */

// 类型与分类数据（正本 src/types/failure.ts；harness#137 删掉 ./types 兼容 shim，
// 本 barrel 直连正本并把星号改成显式清单——ADR-0003 的「对外给了什么」按名字可答）
export {
  DEFAULT_FAILURE_LOG_FILE,
  ErrorType,
  FailureLevel,
  DEFAULT_CLASSIFICATION_RULES,
  DEFAULT_LEVEL_MAPPING,
} from '../types/failure';
export type {
  ErrorClassificationRule,
  FailureRecord,
  ClassificationResult,
} from '../types/failure';

// 分类器
export {
  ErrorClassifier,
  createErrorClassifier,
  classifyError,
  getFailureLevel,
  type ErrorClassifierConfig,
} from './classifier';

// 记录器
export {
  FailureRecorder,
  createFailureRecorder,
  type FailureRecorderConfig,
} from './recorder';
