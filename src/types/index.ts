/**
 * 类型导出
 */

// 约束类型（三层体系）
export * from './constraint';

export * from './checkpoint';
export * from './passes-gate';
export * from './cso';

// Trace 类型（Execution Trace 系统）
export * from './trace';

// Session 类型（排除与 passes-gate 冲突的类型）
export {
  StartupCheckpoints,
  StartupCheckpointType,
  StartupCheckpointResult,
  CleanStateConfig,
  CleanStateResult,
  DetectedBug,
  TaskListJson,
  TaskStepStatus,
  SessionInfo,
} from './session';

// 从 session 导入 DynamicTask，扩展 passes-gate 的定义
export { DynamicTask as ExtendedDynamicTask, TaskTestResult as ExtendedTaskTestResult } from './session';

// 项目配置类型
export * from './project-config';

// Spec 验证类型
export * from './spec';

// Failure 类型（定义已归位 types/failure.ts，failure 模块经 failure/types.ts 再导出保持兼容）
// 显式再导出（不用 export *）：根入口同时星导出 ./failure，星-星歧义会静默丢符号
export {
  ErrorType,
  FailureLevel,
  ErrorClassificationRule,
  FailureRecord,
  ClassificationResult,
  DEFAULT_CLASSIFICATION_RULES,
  DEFAULT_LEVEL_MAPPING,
} from './failure';
