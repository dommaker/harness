/**
 * 知识注入器
 *
 * 将知识条目转换为 ContextSource，注入到 TokenPipeline 的 P3 位置
 * 支持按阶段预算、类型过滤、去重
 */

import { KnowledgeQuery } from '../knowledge/query';
import { TokenEstimator } from './token-budget';
import type { KnowledgeEntry, QueryResult, KnowledgeType } from '../knowledge/types';
import type { ContextSource } from './types';

export interface InjectionConfig {
  /** Token 预算（默认 800） */
  budget: number;
  /** 关注的知识类型 */
  focusTypes?: KnowledgeType[];
  /** 当前阶段 */
  phase?: string;
  /** 已注入的条目 ID（去重） */
  exclude?: string[];
  /** 是否注入摘要版本（已注入的条目） */
  injectSummaryForExcluded?: boolean;
}

export interface InjectionResult {
  sources: ContextSource[];
  tokensUsed: number;
  entriesIncluded: number;
  entriesExcluded: number;
  entriesSummarized: number;
}

export class KnowledgeInjector {
  private query: KnowledgeQuery;

  constructor(query: KnowledgeQuery) {
    this.query = query;
  }

  /**
   * 注入知识到上下文
   */
  inject(config: InjectionConfig): InjectionResult {
    const {
      budget,
      focusTypes,
      phase,
      exclude = [],
      injectSummaryForExcluded = true,
    } = config;

    // 查询知识
    const queryResult = this.query.query({
      phase: phase || 'default',
      maxTokens: budget,
      maxEntries: 20,
      focusTypes: focusTypes || [],
    });

    const sources: ContextSource[] = [];
    let tokensUsed = 0;
    let entriesIncluded = 0;
    let entriesExcluded = 0;
    let entriesSummarized = 0;

    const excludeSet = new Set(exclude);

    for (const entry of queryResult.entries) {
      if (excludeSet.has(entry.id)) {
        entriesExcluded++;

        // 注入摘要版本
        if (injectSummaryForExcluded) {
          const summary = this.formatEntrySummary(entry);
          const summaryTokens = TokenEstimator.estimateText(summary);

          if (tokensUsed + summaryTokens <= budget) {
            sources.push({
              type: 'knowledge',
              id: `knowledge-summary-${entry.id}`,
              content: summary,
              priority: 3,
              metadata: { entryId: entry.id, isSummary: true },
            });
            tokensUsed += summaryTokens;
            entriesSummarized++;
          }
        }

        continue;
      }

      // 注入完整版本
      const formatted = this.formatEntry(entry);
      const entryTokens = TokenEstimator.estimateText(formatted);

      if (tokensUsed + entryTokens <= budget) {
        sources.push({
          type: 'knowledge',
          id: `knowledge-${entry.id}`,
          content: formatted,
          priority: 3,
          metadata: { entryId: entry.id, maturity: entry.maturity },
        });
        tokensUsed += entryTokens;
        entriesIncluded++;
      } else {
        // 预算不足，尝试注入摘要
        const summary = this.formatEntrySummary(entry);
        const summaryTokens = TokenEstimator.estimateText(summary);

        if (tokensUsed + summaryTokens <= budget) {
          sources.push({
            type: 'knowledge',
            id: `knowledge-summary-${entry.id}`,
            content: summary,
            priority: 3,
            metadata: { entryId: entry.id, isSummary: true },
          });
          tokensUsed += summaryTokens;
          entriesSummarized++;
        }
      }
    }

    return {
      sources,
      tokensUsed,
      entriesIncluded,
      entriesExcluded,
      entriesSummarized,
    };
  }

  /**
   * 将知识条目格式化为上下文内容
   */
  formatEntry(entry: KnowledgeEntry): string {
    const parts: string[] = [];

    parts.push(`## [${entry.type.toUpperCase()}] ${entry.title}`);
    parts.push(`ID: ${entry.id} | 成熟度: ${entry.maturity} | 层级: ${entry.layer}`);

    if (entry.tags.length > 0) {
      parts.push(`标签: ${entry.tags.join(', ')}`);
    }

    parts.push('');
    parts.push(entry.content);

    return parts.join('\n');
  }

  /**
   * 将知识条目格式化为摘要（一行）
   */
  formatEntrySummary(entry: KnowledgeEntry): string {
    return `[${entry.id}] ${entry.title} (${entry.maturity}) — ${entry.content.slice(0, 100)}${entry.content.length > 100 ? '...' : ''}`;
  }

  /**
   * 获取查询引擎
   */
  getQuery(): KnowledgeQuery {
    return this.query;
  }
}
