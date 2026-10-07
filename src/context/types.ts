/**
 * 上下文管理类型定义
 *
 * 会话管理（压缩词汇类型 Compaction 系 / ContextSource / SessionMessage 与注入编排
 * 同为零消费面，已随 ADR-0040 Phase 4 连本体删除）
 */

// ========================================
// Session Manager
// ========================================

export type SessionEventType = 'user_message' | 'assistant_message' | 'tool_call' | 'tool_result' | 'checkpoint' | 'system';

export interface SessionEvent {
  type: SessionEventType;
  id: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface SessionHandle {
  id: string;
  events: SessionEvent[];
  createdAt: string;
  lastActiveAt: string;
}

export interface SessionCheckpoint {
  id: string;
  sessionId: string;
  timestamp: string;
  eventCount: number;
  summary: string;
}
