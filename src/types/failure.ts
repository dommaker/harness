/**
 * 失败处理类型定义
 *
 * 提供通用的错误分类和失败记录类型
 * 不包含业务逻辑，只定义数据结构
 *
 * 运行时数据（ErrorType / FailureLevel 两枚 enum 与 DEFAULT_CLASSIFICATION_RULES /
 * DEFAULT_LEVEL_MAPPING 两张默认表）已移回 `src/failure/error-types.ts`
 * （ADR-0040 Phase 3：恢复 types 层「零依赖公共类型层」）；此处只留纯类型与
 * 零依赖路径常量，枚举类型经 type-only 引用（不产生值级依赖）。
 */

import type { ErrorType, FailureLevel } from '../failure/error-types';

/**
 * 默认 failure 日志路径（相对项目根目录）
 *
 * 读写双方必须统一引用此常量（DEFAULT_TRACE_FILE 同款先例）；
 * 自定义路径时向 FailureRecorder 传入自定 logFile
 */
export const DEFAULT_FAILURE_LOG_FILE = '.harness/logs/failures.log';

/**
 * 错误分类规则
 */
export interface ErrorClassificationRule {
  /** 匹配的错误类型 */
  type: ErrorType;
  /** 正则匹配模式 */
  patterns?: RegExp[];
  /** 关键词匹配（不区分大小写） */
  keywords?: string[];
  /** 失败等级 */
  level?: FailureLevel;
  /** 规则描述 */
  description?: string;
}

/**
 * 失败记录
 */
export interface FailureRecord {
  /** 错误类型 */
  type: ErrorType;
  /** 失败等级 */
  level: FailureLevel;
  /** 错误消息 */
  message: string;
  /** 时间戳 */
  timestamp: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 分类结果
 */
export interface ClassificationResult {
  /** 错误类型 */
  type: ErrorType;
  /** 失败等级 */
  level: FailureLevel;
  /** 匹配的规则（如果有） */
  matchedRule?: ErrorClassificationRule;
  /** 原始错误 */
  originalError: Error;
}
