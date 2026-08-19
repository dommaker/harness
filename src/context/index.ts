/**
 * 上下文管理模块（ADR-0003：显式清单，禁 export *）
 *
 * Token 预算 + 会话压缩 + 知识注入
 */

// 类型
export type {
  CompactionConfig,
  CompactionLevel,
  ContextSource,
  ContextSourceType,
  ContextUsageSnapshot,
  SessionCheckpoint,
  SessionEvent,
  SessionEventType,
  SessionHandle,
  SessionMessage,
} from './types';
export { DEFAULT_COMPACTION_CONFIG } from './types';

// Token 预算
export { AdaptiveTokenBudget, TokenBudget, TokenEstimator } from './token-budget';

// 会话压缩
export { SessionCompaction } from './compaction';
export type { CompactionResult } from './compaction';

// 会话管理
export { SessionManager } from './session-manager';

// 知识注入
export { KnowledgeInjector } from './knowledge-injector';
export type { InjectionConfig, InjectionResult } from './knowledge-injector';
