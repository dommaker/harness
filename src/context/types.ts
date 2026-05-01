/**
 * 上下文管理类型定义
 *
 * Phase 2: Token 流水线 + 预算 + 压缩
 */

import type { QueryResult } from '../knowledge/types';

// ========================================
// 文件读取预算
// ========================================

export interface FileBudgetConfig {
  maxLines: number;           // 默认 2000
  maxBytes: number;           // 默认 50KB (51200)
  maxTokenEstimate: number;   // 默认 8000
  continuationHint: boolean;  // 默认 true
}

export const DEFAULT_FILE_BUDGET: FileBudgetConfig = {
  maxLines: 2000,
  maxBytes: 51200,
  maxTokenEstimate: 8000,
  continuationHint: true,
};

// ========================================
// 工具输出预算
// ========================================

export interface ToolOutputBudgetConfig {
  maxChars: number;           // 默认 16000
  maxTokenRatio: number;      // 默认 0.3 (占总预算 30%)
  previewLines: number;       // 默认 50
  overflowToDisk: boolean;    // 默认 false
  dedup: boolean;             // 默认 true
}

export const DEFAULT_TOOL_OUTPUT_BUDGET: ToolOutputBudgetConfig = {
  maxChars: 16000,
  maxTokenRatio: 0.3,
  previewLines: 50,
  overflowToDisk: false,
  dedup: true,
};

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
// Token Pipeline
// ========================================

export type ContextSourceType = 'session_event' | 'tool_output' | 'knowledge' | 'user_message' | 'system_prompt' | 'tool_definition';

export interface ContextSource {
  type: ContextSourceType;
  id: string;
  content: string;
  priority: number;  // P1-P6
  metadata?: Record<string, any>;
}

export interface TokenBudgetAllocation {
  total: number;
  systemPrompt: number;    // 固定，不压缩
  toolDefinitions: number; // 按需懒加载
  knowledge: number;       // 500-800
  notes: number;           // 200-500
  history: number;         // 剩余预算
}

export interface PipelineInput {
  sources: ContextSource[];
  budget: TokenBudgetAllocation;
  knowledge?: QueryResult;
}

export interface PipelineOutput {
  prompt: string;
  snapshot: ContextUsageSnapshot;
  dropped: Array<{ type: string; id: string; reason: string }>;
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
