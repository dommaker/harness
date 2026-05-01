/**
 * 知识生命周期钩子
 *
 * 与 Agent 生命周期集成：
 * - 启动时注入相关知识上下文
 * - 完成时提取新知识
 */

import type { KnowledgeEntry, KnowledgeType } from './types';
import { KnowledgeStore } from './store';
import { KnowledgeQuery } from './query';
import type { ContextSource } from '../context/types';

// ── 钩子配置 ─────────────────────────────────────────────

export interface LifecycleHookConfig {
  store: KnowledgeStore;
  query: KnowledgeQuery;
  /** 启动时注入的最大 token 数 */
  injectionBudget?: number;
  /** 完成时提取的最大条目数 */
  maxExtractionEntries?: number;
  /** 当前阶段 */
  phase?: string;
}

// ── 提取结果 ─────────────────────────────────────────────

export interface ExtractionResult {
  entries: KnowledgeEntry[];
  source: 'archive' | 'error' | 'decision';
}

// ── 生命周期钩子 ─────────────────────────────────────────

export class KnowledgeLifecycleHooks {
  private config: LifecycleHookConfig;

  constructor(config: LifecycleHookConfig) {
    this.config = config;
  }

  /**
   * 启动钩子：注入相关知识到上下文
   *
   * 在 Agent session 启动时调用
   */
  onSessionStart(options?: {
    phase?: string;
    budget?: number;
    focusTypes?: KnowledgeType[];
    exclude?: string[];
  }): ContextSource[] {
    const budget = options?.budget ?? this.config.injectionBudget ?? 800;
    const phase = options?.phase ?? this.config.phase ?? 'default';

    const queryResult = this.config.query.query({
      phase,
      maxTokens: budget,
      maxEntries: 10,
      focusTypes: options?.focusTypes ?? [],
    });

    const sources: ContextSource[] = [];
    const excludeSet = new Set(options?.exclude ?? []);

    for (const entry of queryResult.entries) {
      if (excludeSet.has(entry.id)) continue;

      sources.push({
        type: 'knowledge',
        id: `knowledge-${entry.id}`,
        content: this.formatForContext(entry),
        priority: 3,
        metadata: { entryId: entry.id, maturity: entry.maturity },
      });
    }

    return sources;
  }

  /**
   * 完成钩子：从产物中提取新知识
   *
   * 在 Agent task 完成时调用（ARCHIVE 阶段）
   */
  onTaskComplete(context: {
    taskDescription: string;
    changedFiles?: string[];
    testResults?: string;
    errors?: string[];
    decisions?: string[];
  }): ExtractionResult {
    const entries: KnowledgeEntry[] = [];

    // 从错误中提取 pitfall
    if (context.errors && context.errors.length > 0) {
      for (const error of context.errors.slice(0, 3)) {
        entries.push(this.createExtractionEntry({
          title: `踩坑: ${error.slice(0, 100)}`,
          content: error,
          type: 'pitfall',
          tags: ['auto-extract', 'error'],
        }));
      }
    }

    // 从决策中提取 decision
    if (context.decisions && context.decisions.length > 0) {
      for (const decision of context.decisions.slice(0, 3)) {
        entries.push(this.createExtractionEntry({
          title: `决策: ${decision.slice(0, 100)}`,
          content: decision,
          type: 'decision',
          tags: ['auto-extract', 'decision'],
        }));
      }
    }

    // 保存到知识库
    for (const entry of entries) {
      this.config.store.save(entry);
    }

    return {
      entries,
      source: 'archive',
    };
  }

  /**
   * 错误钩子：从错误中提取知识
   */
  onError(error: Error, context?: {
    taskDescription?: string;
    stackTrace?: string;
  }): ExtractionResult {
    const content = [
      `错误: ${error.message}`,
      context?.stackTrace ? `\n堆栈:\n${context.stackTrace}` : '',
      context?.taskDescription ? `\n任务: ${context.taskDescription}` : '',
    ].filter(Boolean).join('\n');

    const entry = this.createExtractionEntry({
      title: `踩坑: ${error.message.slice(0, 100)}`,
      content,
      type: 'pitfall',
      tags: ['auto-extract', 'error', 'runtime'],
    });

    this.config.store.save(entry);

    return {
      entries: [entry],
      source: 'error',
    };
  }

  // ── 辅助方法 ───────────────────────────────────────────

  private formatForContext(entry: KnowledgeEntry): string {
    const parts: string[] = [];
    parts.push(`## [${entry.type.toUpperCase()}] ${entry.title}`);
    parts.push(`成熟度: ${entry.maturity}`);
    if (entry.tags.length > 0) {
      parts.push(`标签: ${entry.tags.join(', ')}`);
    }
    parts.push('');
    parts.push(entry.content);
    return parts.join('\n');
  }

  private createExtractionEntry(params: {
    title: string;
    content: string;
    type: KnowledgeType;
    tags: string[];
  }): KnowledgeEntry {
    return {
      id: `extract-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: params.type,
      title: params.title,
      content: params.content,
      maturity: 'draft',
      layer: 'project',
      created: new Date().toISOString(),
      lastReferenced: '',
      contributors: [],
      projects: [],
      tags: params.tags,
      applicablePhases: [],
      sourceReferences: [{
        workflow: 'lifecycle-hook',
        timestamp: new Date().toISOString(),
      }],
      referencedBy: [],
    };
  }
}
