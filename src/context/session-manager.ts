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
import type {
  SessionEvent,
  SessionHandle,
  SessionCheckpoint,
} from './types';

export class SessionManager {
  private basePath: string;
  private sessions: Map<string, SessionHandle> = new Map();

  constructor(basePath?: string) {
    this.basePath = basePath || process.cwd();
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

    // 创建会话目录（fail-fast：建不出来说明 basePath 不可写，后续持久化必败，早抛）
    fs.mkdirSync(this.getSessionDir(id), { recursive: true });

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

    // 从磁盘恢复（fail-fast：readJsonl 对缺文件返回空结果、坏行按 skip 跳过，
    // 走到抛错只剩真 IO 故障——曾经整体 catch 吞成 undefined，把 bug 伪装成「会话不存在」）
    const eventsPath = path.join(this.getSessionDir(id), 'events.jsonl');
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
   * 持久化事件到 JSONL（fail-fast：写失败即抛——静默吞掉会让事件日志悄悄缺行）
   */
  private appendEvent(sessionId: string, event: SessionEvent): void {
    // 写链收口：ensureDir + append（harness#82）
    appendJsonl(path.join(this.getSessionDir(sessionId), 'events.jsonl'), event);
  }

  /**
   * 保存 checkpoint（fail-fast：写失败即抛，理由同 appendEvent）
   */
  private saveCheckpoint(sessionId: string, checkpoint: SessionCheckpoint): void {
    const checkpointDir = path.join(this.getSessionDir(sessionId), 'checkpoints');
    fs.mkdirSync(checkpointDir, { recursive: true });

    const checkpointPath = path.join(checkpointDir, `${checkpoint.id}.json`);
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }

  /**
   * 获取会话目录
   */
  private getSessionDir(sessionId: string): string {
    return path.join(this.basePath, '.harness', 'sessions', sessionId);
  }
}
