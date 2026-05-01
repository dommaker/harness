/**
 * 会话压缩
 *
 * 三档策略：eviction / summary / checkpoint
 * 不调用 LLM，零 token 成本
 */

import { TokenEstimator } from './token-budget';
import type { CompactionConfig, CompactionLevel, SessionMessage } from './types';
import { DEFAULT_COMPACTION_CONFIG } from './types';

export interface CompactionResult {
  compacted: SessionMessage[];
  summary?: string;
  level: CompactionLevel;
  originalTokens: number;
  compactedTokens: number;
}

export class SessionCompaction {
  private config: CompactionConfig;

  constructor(config?: Partial<CompactionConfig>) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }

  /**
   * 检查是否需要压缩
   */
  shouldCompact(messages: SessionMessage[], budget: number): boolean {
    const totalTokens = this.estimateMessages(messages);
    return totalTokens / budget > this.config.triggerRatio;
  }

  /**
   * 执行压缩
   */
  compact(messages: SessionMessage[], budget: number): CompactionResult {
    const originalTokens = this.estimateMessages(messages);

    switch (this.config.level) {
      case 'eviction':
        return this.evictionCompact(messages, budget, originalTokens);
      case 'summary':
        return this.summaryCompact(messages, budget, originalTokens);
      case 'checkpoint':
        return this.checkpointCompact(messages, budget, originalTokens);
      default:
        return this.evictionCompact(messages, budget, originalTokens);
    }
  }

  /**
   * 轻量压缩：按比例丢最早消息，保留 tool-call 边界对
   */
  private evictionCompact(messages: SessionMessage[], budget: number, originalTokens: number): CompactionResult {
    const targetTokens = Math.floor(budget * 0.6); // 目标压缩到 60%
    const keepRatio = targetTokens / originalTokens;

    // 至少保留最近 2 条
    const minKeep = Math.min(2, messages.length);
    const keepCount = Math.max(minKeep, Math.floor(messages.length * keepRatio));

    let compacted = messages.slice(-keepCount);

    // 保留 tool-call 边界对
    if (this.config.preserveToolCallPairs) {
      compacted = this.preserveToolCallPairs(messages, compacted);
    }

    const compactedTokens = this.estimateMessages(compacted);

    return {
      compacted,
      level: 'eviction',
      originalTokens,
      compactedTokens,
    };
  }

  /**
   * 中等压缩：结构化总结 + 保留最近 N 轮
   */
  private summaryCompact(messages: SessionMessage[], budget: number, originalTokens: number): CompactionResult {
    const recentCount = Math.min(6, messages.length); // 保留最近 6 条
    const recent = messages.slice(-recentCount);
    const older = messages.slice(0, -recentCount);

    // 生成结构化摘要
    const summary = this.generateStructuredSummary(older);

    // 摘要作为系统消息插入
    const summarySessionMessage: SessionMessage = {
      role: 'assistant',
      content: `[会话摘要]\n${summary}`,
      timestamp: new Date().toISOString(),
    };

    const compacted = [summarySessionMessage, ...recent];
    const compactedTokens = this.estimateMessages(compacted);

    return {
      compacted,
      summary,
      level: 'summary',
      originalTokens,
      compactedTokens,
    };
  }

  /**
   * 重型压缩：checkpoint + 清空历史
   */
  private checkpointCompact(messages: SessionMessage[], budget: number, originalTokens: number): CompactionResult {
    const summary = this.generateStructuredSummary(messages);

    const checkpointSessionMessage: SessionMessage = {
      role: 'assistant',
      content: `[Checkpoint]\n${summary}\n\n[历史已压缩，共 ${messages.length} 条消息]`,
      timestamp: new Date().toISOString(),
    };

    const compacted = [checkpointSessionMessage];
    const compactedTokens = this.estimateMessages(compacted);

    return {
      compacted,
      summary,
      level: 'checkpoint',
      originalTokens,
      compactedTokens,
    };
  }

  /**
   * 生成结构化摘要（零 LLM 成本）
   */
  generateStructuredSummary(messages: SessionMessage[]): string {
    const sections: string[] = [];

    // 提取用户目标
    const userSessionMessages = messages.filter(m => m.role === 'user');
    if (userSessionMessages.length > 0) {
      sections.push(`用户目标: ${userSessionMessages[0].content.slice(0, 200)}`);
    }

    // 提取工具调用
    const toolCalls = messages.filter(m => m.role === 'tool');
    if (toolCalls.length > 0) {
      sections.push(`工具调用: ${toolCalls.length} 次`);
    }

    // 提取关键信息
    const assistantSessionMessages = messages.filter(m => m.role === 'assistant');
    if (assistantSessionMessages.length > 0) {
      const lastAssistant = assistantSessionMessages[assistantSessionMessages.length - 1];
      sections.push(`最近响应: ${lastAssistant.content.slice(0, 200)}`);
    }

    sections.push(`消息总数: ${messages.length}`);
    sections.push(`时间范围: ${messages[0]?.timestamp || 'N/A'} → ${messages[messages.length - 1]?.timestamp || 'N/A'}`);

    return sections.join('\n');
  }

  /**
   * 保留 tool-call 边界对
   *
   * 如果 tool 结果被保留，对应的 tool 调用也要保留
   */
  private preserveToolCallPairs(all: SessionMessage[], compacted: SessionMessage[]): SessionMessage[] {
    const compactedIds = new Set(compacted.map(m => m.toolCallId).filter(Boolean));
    const result: SessionMessage[] = [];

    for (const msg of compacted) {
      // 如果是 tool 结果，确保对应的 tool 调用也在
      if (msg.role === 'tool' && msg.toolCallId) {
        const paired = all.find(m => m.toolCallId === msg.toolCallId && m.role === 'assistant');
        if (paired && !compacted.some(m => m === paired)) {
          result.push(paired);
        }
      }
      result.push(msg);
    }

    return result;
  }

  /**
   * 估算消息的 token 数
   */
  private estimateMessages(messages: SessionMessage[]): number {
    return messages.reduce((sum, m) => sum + TokenEstimator.estimateText(m.content), 0);
  }

  /**
   * 获取配置
   */
  getConfig(): CompactionConfig {
    return { ...this.config };
  }
}
