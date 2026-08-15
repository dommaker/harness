/**
 * 上下文管理类型定义
 *
 * Token 预算 + 会话压缩 + 会话管理 + 知识注入
 */

// ========================================
// 会话压缩
// ========================================

export type CompactionLevel = 'eviction' | 'summary' | 'checkpoint';

export interface CompactionConfig {
  triggerRatio: number;            // 默认 0.8
  level: CompactionLevel;
  preserveToolCallPairs: boolean;  // 默认 true
  structuredSummary: boolean;      // 默认 true
  maxSummaryTokens: number;        // 默认 2000
  fallbackStrategy: 'truncate-middle' | 'head-drop' | 'retry-with-clamp';
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  triggerRatio: 0.8,
  level: 'eviction',
  preserveToolCallPairs: true,
  structuredSummary: true,
  maxSummaryTokens: 2000,
  fallbackStrategy: 'truncate-middle',
};

export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  timestamp: string;
}

// ========================================
// 上下文来源
// ========================================

export type ContextSourceType = 'session_event' | 'tool_output' | 'knowledge' | 'user_message' | 'system_prompt' | 'tool_definition';

export interface ContextSource {
  type: ContextSourceType;
  id: string;
  content: string;
  priority: number;  // P1-P6
  metadata?: Record<string, any>;
}

// ========================================
// 上下文使用快照
// ========================================

export interface ContextUsageSnapshot {
  timestamp: string;
  totalTokens: number;
  breakdown: {
    systemPrompt: number;
    messages: number;
    toolOutputs: number;
    knowledge: number;
    other: number;
  };
  truncatedItems: Array<{ type: string; id: string; originalTokens: number; keptTokens: number }>;
  offloadedItems: Array<{ type: string; id: string; target: 'disk' | 'summary' | 'dropped' }>;
  compactionTriggered: boolean;
  compactionLevel?: CompactionLevel;
}

// ========================================
// Session Manager
// ========================================

export type SessionEventType = 'user_message' | 'assistant_message' | 'tool_call' | 'tool_result' | 'checkpoint' | 'system';

export interface SessionEvent {
  type: SessionEventType;
  id: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
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
