/**
 * 失败处理模块
 *
 * 提供通用的错误分类和记录能力
 * 不包含业务逻辑
 */

// 类型
export * from './types';

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
