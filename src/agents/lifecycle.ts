/**
 * Agent 生命周期管理
 *
 * 管理 Agent 的启动、监控、回退、终止
 */

import type {
  AgentConfig,
  AgentState,
  AgentStatus,
  AgentEvent,
  FallbackStrategy,
} from './types';

export type EventHandler = (event: AgentEvent) => void;

export class AgentLifecycle {
  private agents: Map<string, AgentState>;
  private configs: Map<string, AgentConfig>;
  private strategies: FallbackStrategy[];
  private eventHandlers: EventHandler[];

  constructor() {
    this.agents = new Map();
    this.configs = new Map();
    this.strategies = [];
    this.eventHandlers = [];
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
    this.emit({ type: 'start', agentId: id, timestamp: state.startedAt });
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
    this.emit({ type: 'complete', agentId: id, timestamp: state.completedAt, data: metadata });
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
    this.emit({ type: 'error', agentId: id, timestamp: new Date().toISOString(), data: { error } });

    // 检查回退策略
    this.applyFallbackStrategies(state);
    return state;
  }

  /**
   * 终止 Agent
   */
  terminate(id: string): AgentState | undefined {
    const state = this.agents.get(id);
    if (!state) return undefined;

    state.status = 'terminated';
    state.completedAt = new Date().toISOString();
    this.emit({ type: 'terminate', agentId: id, timestamp: state.completedAt });
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

  /**
   * 按状态过滤
   */
  getByStatus(status: AgentStatus): AgentState[] {
    return this.getAllStates().filter(s => s.status === status);
  }

  /**
   * 注册回退策略
   */
  addFallbackStrategy(strategy: FallbackStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * 注册事件处理器
   */
  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * 应用回退策略
   */
  private applyFallbackStrategies(state: AgentState): void {
    const config = this.configs.get(state.id);
    if (!config) return;

    for (const strategy of this.strategies) {
      if (!strategy.condition(state)) continue;

      switch (strategy.action) {
        case 'retry': {
          const maxRetries = config.maxRetries ?? 3;
          if (state.retryCount < maxRetries) {
            state.retryCount++;
            state.status = 'running';
            state.error = undefined;
            this.emit({
              type: 'retry',
              agentId: state.id,
              timestamp: new Date().toISOString(),
              data: { attempt: state.retryCount },
            });
          }
          break;
        }
        case 'degrade':
          state.status = 'paused';
          state.metadata.degraded = true;
          break;
        case 'abort':
          state.status = 'terminated';
          break;
        case 'notify':
          // 通知由事件处理器处理
          break;
      }
    }
  }

  private emit(event: AgentEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // 事件处理器不应影响主流程
      }
    }
  }

  /**
   * 移除 Agent
   */
  remove(id: string): boolean {
    this.configs.delete(id);
    return this.agents.delete(id);
  }

  /**
   * 清空所有 Agent
   */
  clear(): void {
    this.agents.clear();
    this.configs.clear();
  }
}
