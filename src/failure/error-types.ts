/**
 * 失败处理的运行时数据 + 纯类型（ADR-0040 Phase 3 自 types/failure.ts 移回）
 *
 * enum 与默认分类规则/等级映射是运行时值，不属于 types 层「零依赖公共类型层」；
 * 纯类型（ErrorClassificationRule / FailureRecord / ClassificationResult）随重构
 * 班次 3 Phase 4 同文件归位——原住 types/failure.ts 造成 types/ ↔ failure/ 的
 * type 级互引环（本文件 type-import 接口、接口文件 type-import 枚举），下移后
 * types/failure.ts 只剩零依赖路径常量 DEFAULT_FAILURE_LOG_FILE。
 */

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

/**
 * 错误类型枚举
 */
export enum ErrorType {
  TEST_FAILED = 'TEST_FAILED',
  GATE_FAILED = 'GATE_FAILED',
  DEPENDENCY_BLOCKED = 'DEPENDENCY_BLOCKED',
  CONTEXT_OVERFLOW = 'CONTEXT_OVERFLOW',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  AGENT_ERROR = 'AGENT_ERROR',
  TOOL_ERROR = 'TOOL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/**
 * 失败等级
 *
 * L1: 自动处理（重试、降级）
 * L2: 需要干预（人工审核）
 * L3: 严重问题（开会讨论）
 * L4: 致命错误（回滚）
 */
export enum FailureLevel {
  L1 = 'L1',
  L2 = 'L2',
  L3 = 'L3',
  L4 = 'L4',
}

/**
 * 默认错误分类规则
 *
 * 注意：规则按顺序匹配，更具体的规则应该放在前面
 */
export const DEFAULT_CLASSIFICATION_RULES: ErrorClassificationRule[] = [
  // 更具体的规则优先
  {
    type: ErrorType.GATE_FAILED,
    keywords: ['gate', 'checkpoint', 'constraint'],
    level: FailureLevel.L2,
    description: '门禁检查失败',
  },
  {
    type: ErrorType.DEPENDENCY_BLOCKED,
    keywords: ['dependency', 'blocked', 'dependency_fail'],
    level: FailureLevel.L3,
    description: '依赖阻塞',
  },
  {
    type: ErrorType.CONTEXT_OVERFLOW,
    keywords: ['context overflow', 'token limit', 'context exceed'],
    level: FailureLevel.L2,
    description: '上下文溢出',
  },
  {
    type: ErrorType.TIMEOUT,
    keywords: ['timeout', 'timed out', 'deadline'],
    patterns: [/timeout/i, /timed?\s*out/i],
    level: FailureLevel.L1,
    description: '超时',
  },
  {
    type: ErrorType.NETWORK_ERROR,
    keywords: ['network', 'connection', 'econnrefused', 'enotfound', 'socket'],
    level: FailureLevel.L1,
    description: '网络错误',
  },
  {
    type: ErrorType.AGENT_ERROR,
    keywords: ['agent error', 'model error', 'rate limit', 'quota exceeded'],
    level: FailureLevel.L2,
    description: 'Agent 错误',
  },
  {
    type: ErrorType.TOOL_ERROR,
    keywords: ['tool error', 'skill error', 'executor error'],
    level: FailureLevel.L1,
    description: '工具错误',
  },
  {
    type: ErrorType.VALIDATION_ERROR,
    keywords: ['validation error', 'invalid', 'schema error'],
    level: FailureLevel.L2,
    description: '验证错误',
  },
  // 通用规则放在后面
  {
    type: ErrorType.TEST_FAILED,
    keywords: ['test', 'assertion', 'expect'],
    patterns: [/test.*fail/i, /assertion/i, /expect.*fail/i],
    level: FailureLevel.L1,
    description: '测试失败',
  },
];

/**
 * 错误类型到失败等级的默认映射
 */
export const DEFAULT_LEVEL_MAPPING: Record<ErrorType, FailureLevel> = {
  [ErrorType.TEST_FAILED]: FailureLevel.L1,
  [ErrorType.GATE_FAILED]: FailureLevel.L2,
  [ErrorType.DEPENDENCY_BLOCKED]: FailureLevel.L3,
  [ErrorType.CONTEXT_OVERFLOW]: FailureLevel.L2,
  [ErrorType.TIMEOUT]: FailureLevel.L1,
  [ErrorType.NETWORK_ERROR]: FailureLevel.L1,
  [ErrorType.AGENT_ERROR]: FailureLevel.L2,
  [ErrorType.TOOL_ERROR]: FailureLevel.L1,
  [ErrorType.VALIDATION_ERROR]: FailureLevel.L2,
  [ErrorType.UNKNOWN]: FailureLevel.L2,
};
