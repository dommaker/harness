/**
 * 上下文管理模块（ADR-0003：显式清单，禁 export *）
 *
 * Token 预算 + 会话管理 + 知识注入
 */

// 类型
export type {
  CompactionConfig,
  CompactionLevel,
  ContextSource,
  ContextSourceType,
  SessionCheckpoint,
  SessionEvent,
  SessionEventType,
  SessionHandle,
  SessionMessage,
} from './types';

// ContextUsageSnapshot 正本已迁 `monitoring/context-tracker.ts`（生产者/唯一消费者
// 是 ContextTracker，断 context↔monitoring 环）；此处 type-only 转发仅保 `./context`
// 子路径公共面不缩（增删即 breaking，ADR-0022 追记 4）
export type { ContextUsageSnapshot } from '../monitoring/context-tracker';

// Token 预算
export { TokenBudget, TokenEstimator } from './token-budget';

// 会话管理
export { SessionManager } from './session-manager';

// 知识注入
export { KnowledgeInjector } from './knowledge-injector';
export type { InjectionConfig, InjectionResult } from './knowledge-injector';
