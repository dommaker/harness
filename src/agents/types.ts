/**
 * Agent 生命周期类型定义
 */

export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'terminated';

export interface AgentConfig {
  /** Agent ID */
  id: string;
  /** Agent 名称 */
  name: string;
  /** 工作目录 */
  workingDir: string;
  /** 失败重试次数 */
  maxRetries?: number;
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
