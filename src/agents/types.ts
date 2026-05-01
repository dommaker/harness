/**
 * Agent 生命周期类型定义
 */

export type AgentStatus = 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'failed' | 'terminated';

export interface AgentConfig {
  /** Agent ID */
  id: string;
  /** Agent 名称 */
  name: string;
  /** 工作目录 */
  workingDir: string;
  /** 最大运行时间（ms） */
  maxRunTime?: number;
  /** 失败重试次数 */
  maxRetries?: number;
  /** Sandbox 级别 */
  sandboxLevel?: 1 | 2 | 3 | 4;
}

export interface AgentState {
  id: string;
  status: AgentStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  retryCount: number;
  metadata: Record<string, unknown>;
}

export interface AgentEvent {
  type: 'start' | 'progress' | 'complete' | 'error' | 'retry' | 'terminate';
  agentId: string;
  timestamp: string;
  data?: unknown;
}

export interface FallbackStrategy {
  /** 回退条件 */
  condition: (state: AgentState) => boolean;
  /** 回退动作 */
  action: 'retry' | 'degrade' | 'abort' | 'notify';
  /** 回退参数 */
  params?: Record<string, unknown>;
}
