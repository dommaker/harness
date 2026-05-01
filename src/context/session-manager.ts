/**
 * Session Manager
 *
 * 解耦 Session（持久事件日志）/ Harness（窗口视图）/ Sandbox（执行环境）
 * Session 事件存储：.harness/sessions/{id}/events.jsonl
 * Checkpoint 存储：.harness/sessions/{id}/checkpoints/
 */

import * as fs from 'fs';
import * as path from 'path';
import { TokenPipeline } from './token-pipeline';
import { ContextTracker } from '../monitoring/context-tracker';
import type {
  SessionEvent,
  SessionHandle,
  SessionCheckpoint,
  TokenBudgetAllocation,
  PipelineOutput,
  ContextSource,
} from './types';

export class SessionManager {
  private basePath: string;
  private sessions: Map<string, SessionHandle> = new Map();
  private pipeline: TokenPipeline;
  private tracker: ContextTracker;

  constructor(basePath?: string) {
    this.basePath = basePath || process.cwd();
    this.pipeline = new TokenPipeline();
    this.tracker = new ContextTracker(this.basePath);
  }

  /**
   * 创建会话
   */
  createSession(id: string): SessionHandle {
    const handle: SessionHandle = {
      id,
      events: [],
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    this.sessions.set(id, handle);

    // 创建会话目录
    const sessionDir = this.getSessionDir(id);
    try {
      fs.mkdirSync(sessionDir, { recursive: true });
    } catch {
      // 目录创建失败，静默处理
    }

    return handle;
  }

  /**
   * 追加事件到会话
   */
  appendToSession(id: string, event: SessionEvent): void {
    const handle = this.sessions.get(id);
    if (!handle) {
      throw new Error(`会话 ${id} 不存在`);
    }

    handle.events.push(event);
    handle.lastActiveAt = new Date().toISOString();

    // 持久化到 JSONL
    this.appendEvent(id, event);
  }

  /**
   * 获取当前轮窗口视图
   *
   * 将 session 事件转换为 ContextSource，通过 TokenPipeline 生成 prompt
   */
  getWindowView(id: string, budget: TokenBudgetAllocation): PipelineOutput {
    const handle = this.sessions.get(id);
    if (!handle) {
      throw new Error(`会话 ${id} 不存在`);
    }

    // 将事件转换为 ContextSource
    const sources = this.eventsToSources(handle.events);

    // 通过 pipeline 生成窗口视图
    const output = this.pipeline.run({ sources, budget });

    // 记录快照
    this.tracker.record(output.snapshot);

    return output;
  }

  /**
   * 生成 checkpoint
   */
  checkpointSession(id: string): SessionCheckpoint {
    const handle = this.sessions.get(id);
    if (!handle) {
      throw new Error(`会话 ${id} 不存在`);
    }

    const checkpoint: SessionCheckpoint = {
      id: `cp-${Date.now()}`,
      sessionId: id,
      timestamp: new Date().toISOString(),
      eventCount: handle.events.length,
      summary: this.generateCheckpointSummary(handle.events),
    };

    // 持久化 checkpoint
    this.saveCheckpoint(id, checkpoint);

    return checkpoint;
  }

  /**
   * 从 checkpoint 恢复会话
   */
  restoreSession(checkpointId: string): SessionHandle {
    // 搜索所有会话的 checkpoints
    const sessionsDir = path.join(this.basePath, '.harness', 'sessions');

    try {
      const sessionIds = fs.readdirSync(sessionsDir);

      for (const sessionId of sessionIds) {
        const checkpointPath = path.join(sessionsDir, sessionId, 'checkpoints', `${checkpointId}.json`);

        if (fs.existsSync(checkpointPath)) {
          const checkpointData = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8')) as SessionCheckpoint;

          // 恢复会话
          const handle = this.createSession(sessionId);

          // 从 events.jsonl 恢复事件
          const eventsPath = path.join(sessionsDir, sessionId, 'events.jsonl');
          if (fs.existsSync(eventsPath)) {
            const content = fs.readFileSync(eventsPath, 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);

            // 只恢复 checkpoint 之前的事件
            const events = lines
              .slice(0, checkpointData.eventCount)
              .map(line => {
                try {
                  return JSON.parse(line) as SessionEvent;
                } catch {
                  return null;
                }
              })
              .filter((e): e is SessionEvent => e !== null);

            handle.events = events;
          }

          return handle;
        }
      }
    } catch {
      // 恢复失败
    }

    throw new Error(`Checkpoint ${checkpointId} 不存在`);
  }

  /**
   * 获取会话信息
   */
  getSession(id: string): SessionHandle | undefined {
    return this.sessions.get(id);
  }

  /**
   * 获取 tracker
   */
  getTracker(): ContextTracker {
    return this.tracker;
  }

  /**
   * 将事件转换为 ContextSource
   */
  private eventsToSources(events: SessionEvent[]): ContextSource[] {
    return events.map(event => {
      let priority: number;
      let type: ContextSource['type'];

      switch (event.type) {
        case 'system':
          priority = 1;
          type = 'system_prompt';
          break;
        case 'user_message':
          priority = 6;
          type = 'user_message';
          break;
        case 'assistant_message':
          priority = 5;
          type = 'session_event';
          break;
        case 'tool_call':
        case 'tool_result':
          priority = 5;
          type = 'tool_output';
          break;
        case 'checkpoint':
          priority = 4;
          type = 'session_event';
          break;
        default:
          priority = 5;
          type = 'session_event';
      }

      return {
        type,
        id: event.id,
        content: event.content,
        priority,
        metadata: event.metadata,
      };
    });
  }

  /**
   * 生成 checkpoint 摘要
   */
  private generateCheckpointSummary(events: SessionEvent[]): string {
    const userMessages = events.filter(e => e.type === 'user_message');
    const toolCalls = events.filter(e => e.type === 'tool_call');

    const parts: string[] = [];
    parts.push(`事件总数: ${events.length}`);
    parts.push(`用户消息: ${userMessages.length}`);
    parts.push(`工具调用: ${toolCalls.length}`);

    if (userMessages.length > 0) {
      parts.push(`最近目标: ${userMessages[userMessages.length - 1].content.slice(0, 200)}`);
    }

    return parts.join('\n');
  }

  /**
   * 持久化事件到 JSONL
   */
  private appendEvent(sessionId: string, event: SessionEvent): void {
    try {
      const eventsPath = path.join(this.getSessionDir(sessionId), 'events.jsonl');
      const line = JSON.stringify(event) + '\n';
      fs.appendFileSync(eventsPath, line, 'utf-8');
    } catch {
      // 持久化失败，静默处理
    }
  }

  /**
   * 保存 checkpoint
   */
  private saveCheckpoint(sessionId: string, checkpoint: SessionCheckpoint): void {
    try {
      const checkpointDir = path.join(this.getSessionDir(sessionId), 'checkpoints');
      fs.mkdirSync(checkpointDir, { recursive: true });

      const checkpointPath = path.join(checkpointDir, `${checkpoint.id}.json`);
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    } catch {
      // 保存失败，静默处理
    }
  }

  /**
   * 获取会话目录
   */
  private getSessionDir(sessionId: string): string {
    return path.join(this.basePath, '.harness', 'sessions', sessionId);
  }
}
