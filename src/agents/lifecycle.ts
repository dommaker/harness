/**
 * Agent 生命周期管理
 *
 * 管理 Agent 的注册、启动、完成与失败
 */

import type {
  AgentConfig,
  AgentState,
} from './types';

export class AgentLifecycle {
  private agents: Map<string, AgentState>;
  private configs: Map<string, AgentConfig>;

  constructor() {
    this.agents = new Map();
    this.configs = new Map();
  }

  /**
   * 注册 Agent
   */
  register(config: AgentConfig): AgentState {
    const state: AgentState = {
      id: config.id,
      status: 'idle',
      retryCount: 0,
      metadata: {},
    };
    this.agents.set(config.id, state);
    this.configs.set(config.id, config);
    return state;
  }

  /**
   * 启动 Agent
   */
  start(id: string): AgentState | undefined {
    const state = this.agents.get(id);
    if (!state) return undefined;

    state.status = 'running';
    state.startedAt = new Date().toISOString();
    return state;
  }

  /**
   * 完成 Agent
   */
  complete(id: string, metadata?: Record<string, unknown>): AgentState | undefined {
    const state = this.agents.get(id);
    if (!state) return undefined;

    state.status = 'completed';
    state.completedAt = new Date().toISOString();
    if (metadata) state.metadata = { ...state.metadata, ...metadata };
    return state;
  }

  /**
   * 标记失败
   */
  fail(id: string, error: string): AgentState | undefined {
    const state = this.agents.get(id);
    if (!state) return undefined;

    state.status = 'failed';
    state.error = error;
    return state;
  }

  /**
   * 获取 Agent 状态
   */
  getState(id: string): AgentState | undefined {
    return this.agents.get(id);
  }

  /**
   * 获取所有 Agent 状态
   */
  getAllStates(): AgentState[] {
    return Array.from(this.agents.values());
  }
}
