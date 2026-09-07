/**
 * Session Manager
 *
 * 解耦 Session（持久事件日志）/ Harness（窗口视图）/ Sandbox（执行环境）
 * Session 事件存储：.harness/sessions/{id}/events.jsonl
 * Checkpoint 存储：.harness/sessions/{id}/checkpoints/
 */

import * as fs from 'fs';
import * as path from 'path';
import { readJsonl, appendJsonl } from '../utils/jsonl';
import { ContextTracker } from '../monitoring/context-tracker';
import type {
  SessionEvent,
  SessionHandle,
  SessionCheckpoint,
} from './types';

export class SessionManager {
  private basePath: string;
  private sessions: Map<string, SessionHandle> = new Map();
  private tracker: ContextTracker;

  constructor(basePath?: string) {
    this.basePath = basePath || process.cwd();
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
   * 从磁盘加载已持久化的会话（S2）
   *
   * 跨实例恢复：当新的 SessionManager 实例创建时，内存中 sessions Map 为空，
   * 但磁盘上可能有之前持久化的事件。此方法从 events.jsonl 重建 SessionHandle。
   *
   * @returns 加载成功返回 SessionHandle，磁盘无数据返回 undefined
   */
  loadSession(id: string): SessionHandle | undefined {
    // 先检查内存
    const cached = this.sessions.get(id);
    if (cached) return cached;

    // 从磁盘恢复
    const eventsPath = path.join(this.getSessionDir(id), 'events.jsonl');
    try {
      // 坏行策略：skip（原逐行 catch 跳过语义不变，harness#82）；
      // 空文件判定保持原始非空行数口径（合法 + 坏行 = 0 才算空）
      // 计数去向：并进空事件判定的原始行数口径（harness#100 记名豁免：会话恢复面只区分
      // "有没有事件"，单列坏行数不改变任何输出；会话事件写链在本地，损坏=半写入截断）
      const { records: events, skippedLines } = readJsonl<SessionEvent>(eventsPath, 'skip');
      if (events.length + skippedLines === 0) return undefined;

      const stat = fs.statSync(eventsPath);
      const handle: SessionHandle = {
        id,
        events,
        createdAt: stat.birthtime.toISOString(),
        lastActiveAt: stat.mtime.toISOString(),
      };

      this.sessions.set(id, handle);
      return handle;
    } catch {
      return undefined;
    }
  }

  /**
   * 获取会话（自动从磁盘加载，S2）
   *
   * 先查内存缓存，未命中则从磁盘恢复。
   */
  getSession(id: string): SessionHandle | undefined {
    return this.sessions.get(id) ?? this.loadSession(id);
  }

  /**
   * 获取会话摘要信息（S2）
   *
   * 跨实例安全的查询接口。返回轻量级摘要，不加载完整事件列表。
   */
  getSessionInfo(id: string): SessionHandle {
    const handle = this.getSession(id);
    if (!handle) {
      throw new Error(`会话 ${id} 不存在`);
    }
    return handle;
  }

  /**
   * 追加事件到会话（自动从磁盘加载，S2）
   */
  appendToSession(id: string, event: SessionEvent): void {
    const handle = this.getSession(id);
    if (!handle) {
      throw new Error(`会话 ${id} 不存在`);
    }

    handle.events.push(event);
    handle.lastActiveAt = new Date().toISOString();

    // 持久化到 JSONL
    this.appendEvent(id, event);
  }

  /**
   * 生成 checkpoint（自动从磁盘加载，S2）
   */
  checkpointSession(id: string): SessionCheckpoint {
    const handle = this.getSession(id);
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
            // 坏行策略：skip（原逐行 null-filter 语义不变，harness#82）；
            // 只恢复 checkpoint 之前的原始行（head 截断在 parse 之前）；
            // !== null 沿用原过滤口径
            // 计数去向：豁免（harness#100）——恢复路径没有用户可见输出面（失败即整体抛
            // `Checkpoint ${id} 不存在`），坏行只会让恢复出的事件少于 checkpoint 声明数；
            // 告知需要改 loadCheckpoint 的抛错形状，属行为变更不在本票
            const { records } = readJsonl<SessionEvent>(eventsPath, 'skip', {
              head: checkpointData.eventCount,
            });
            handle.events = records.filter((e): e is SessionEvent => e !== null);
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
   * 获取 tracker
   */
  getTracker(): ContextTracker {
    return this.tracker;
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
      // 写链收口：ensureDir + append（harness#82）
      appendJsonl(path.join(this.getSessionDir(sessionId), 'events.jsonl'), event);
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
