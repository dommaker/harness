/**
 * 上下文管理模块（ADR-0003：显式清单，禁 export *）
 *
 * 会话管理
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

// 会话管理
export { SessionManager } from './session-manager';
