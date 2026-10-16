/**
 * 默认 failure 日志路径与（已迁出的）失败处理类型
 *
 * 失败处理的纯类型（ErrorClassificationRule / FailureRecord / ClassificationResult）
 * 已下移 `src/failure/error-types.ts`（重构班次 3 Phase 4：断开本文件 ↔ failure/
 * 的 type 级互引环——types 层零依赖是目标，「type-only 不算依赖」的豁免让环
 * 在机器守卫外空转）；此处只留零依赖路径常量。
 */

/**
 * 默认 failure 日志路径（相对项目根目录）
 *
 * 读写双方必须统一引用此常量（DEFAULT_TRACE_FILE 同款先例）；
 * 自定义路径时向 FailureRecorder 传入自定 logFile
 */
export const DEFAULT_FAILURE_LOG_FILE = '.harness/logs/failures.log';
