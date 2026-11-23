/**
 * Knowledge Query Engine
 *
 * Budget-aware query layer over KnowledgeStore.
 * Supports filtering, sorting by maturity, and result caching.
 */

import type {
  KnowledgeEntry,
  MaturityLevel,
  ConsumptionMode,
  QueryBudget,
  QueryResult,
  QueryFilter,
  IndexEntry,
} from './types';
import type { KnowledgeStore } from './store';
import { filterIndexEntries, indexEntryTokenCount } from './store';
import { KnowledgeLifecycle } from './lifecycle';
import { estimateTokens } from './token-estimate';
import { attempt } from '../utils/attempt';

// ── Constants ──────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * 外部来源条目的 retrieval marking 标准（harness#161：唯一正本）。
 * `KnowledgeQuery.formatForPrompt()` 与下游编排消费方的注入格式化共用同一常量，
 * 仓内不允许存在第二份字面量。
 */
export const EXTERNAL_SOURCE_MARKER = '[External Source — verify before acting]';
const MATURITY_RANK: Record<MaturityLevel, number> = {
  proven: 3,
  verified: 2,
  active: 2,
  draft: 1,
  archived: 0,
  deprecated: 0,
};

// ── Cache ──────────────────────────────────────────────────

interface CacheEntry {
  result: QueryResult;
  timestamp: number;
}

// ── Query Engine ───────────────────────────────────────────

export class KnowledgeQuery {
  private store: KnowledgeStore;
  private lifecycle: KnowledgeLifecycle;
  private cache = new Map<string, CacheEntry>();

  constructor(store: KnowledgeStore, lifecycle?: KnowledgeLifecycle) {
    this.store = store;
    this.lifecycle = lifecycle || new KnowledgeLifecycle(store);
  }

  /**
   * Query knowledge entries within a token budget.
   *
   * - Filters by budget.focusTypes (and optional extra filter)
   * - Sorts: maturity desc → lastReferenced desc
   * - Truncates to budget.maxEntries and budget.maxTokens
   * - Caches results per phase+budget key (TTL 5 min)
   */
  query(budget: QueryBudget, filter?: QueryFilter): QueryResult {
    const cacheKey = this.cacheKey(budget, filter);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { ...cached.result, fromCache: true };
    }

    // Merge focusTypes from budget into filter
    const mergedFilter: QueryFilter = {
      ...filter,
      types: budget.focusTypes.length > 0 ? budget.focusTypes : filter?.types,
      excludeArchived: filter?.excludeArchived ?? true,
    };

    // D7：新索引（候选全带 tokenCount 元数据）先经 index 过滤/排序/截断，
    // 只物化最终返回集；旧索引/外部自定义 store 走 list+applyBudget 兼容路径
    const fromIndex = this.queryFromIndex(mergedFilter, budget);
    let entries: KnowledgeEntry[];
    let tokensUsed: number;
    let truncated: boolean;
    if (fromIndex) {
      ({ entries, tokensUsed, truncated } = fromIndex);
    } else {
      const candidates = this.store.list(mergedFilter);
      const sorted = this.sortEntries(candidates);
      ({ entries, tokensUsed, truncated } = this.applyBudget(sorted, budget));
    }

    const result: QueryResult = { entries, tokensUsed, truncated, fromCache: false };
    this.cache.set(cacheKey, { result, timestamp: Date.now() });

    // P1.3: 一次 query 的全部引用经生命周期批量记账、一次 applyAll 落盘
    // （不再逐条 recordReference→update→全量重写 index.json）
    // D7: 本次已物化条目作为预载传入——记账查线与合并基线零重复读取
    // 显式 fail-open（attempt）：引用记账是查询的副作用，失败不影响查询结果返回
    const preloaded = new Map(entries.map(e => [e.id, e]));
    attempt(
      () => this.lifecycle.recordReferences(entries.map(e => e.id), undefined, undefined, undefined, preloaded),
      () => undefined,
    );

    return result;
  }

  /**
   * Full-text search over the entire corpus.
   *
   * Unlike query(), this is NOT budget-constrained: text matching runs on the
   * full (filtered) corpus first, then results are sorted by
   * maturity desc → lastReferenced desc and capped at `limit`.
   * Token budgets only make sense for prompt injection (query()); interactive
   * search must see every entry or low-ranked entries become unfindable.
   *
   * No caching and no recordReference side effect — searching is not citing.
   */
  search(query: string, options?: { limit?: number; filter?: QueryFilter }): KnowledgeEntry[] {
    const limit = options?.limit ?? 20;
    const candidates = this.store.list({
      excludeArchived: true,
      ...options?.filter,
    });

    const q = query.toLowerCase();
    const matched = candidates.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.tags.some(t => t.toLowerCase().includes(q))
    );

    return this.sortEntries(matched).slice(0, limit);
  }

  /**
   * Estimate token count for a piece of text.
   * 委托仓内唯一尺子正本 `token-estimate.ts`（本类不再自带实现）；保留方法名与语义不变。
   */
  estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  /** Clear the query cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Query entries by consumptionMode.
   * Convenience wrapper around store.list() with mode filter.
   */
  queryByMode(mode: ConsumptionMode, filter?: QueryFilter): KnowledgeEntry[] {
    return this.store.list({
      ...filter,
      consumptionModes: [mode],
    });
  }

  /**
   * Consume knowledge for a task context.
   * Returns entries grouped by consumptionMode for prompt assembly.
   *
   * - rules: rule-mode entries (for prompt injection)
   * - references: reference-mode entries matching task text keywords
   * - context: context-mode entries matching applicablePhases
   */
  consume(taskContext: {
    requirementText?: string;
    phase?: string;
  }): { rules: KnowledgeEntry[]; references: KnowledgeEntry[]; context: KnowledgeEntry[] } {
    // 一次全量 list + 内存分组（等价于按 mode 三次 list；条目 mode 单一，分组保序。
    // signal 条目原三次 queryByMode 均不取，分组后同样不消费）
    const grouped: Record<ConsumptionMode, KnowledgeEntry[]> = { rule: [], reference: [], context: [], signal: [] };
    for (const entry of this.store.list({})) {
      grouped[entry.consumptionMode].push(entry);
    }

    const rules = grouped.rule;

    const allRefs = grouped.reference;
    const references = taskContext.requirementText
      ? this.filterByText(allRefs, taskContext.requirementText).slice(0, 3)
      : allRefs.slice(0, 3);

    const allContext = grouped.context;
    const phase = taskContext.phase;
    const context = phase
      ? allContext.filter(e => e.applicablePhases.includes(phase))
      : allContext;

    return { rules, references, context };
  }

  /**
   * Format entry for prompt injection.
   * Adds [External Source] warning prefix for external-origin entries.
   */
  static formatForPrompt(entry: KnowledgeEntry): string {
    const prefix = entry.origin === 'external'
      ? `${EXTERNAL_SOURCE_MARKER}\n`
      : '';
    return `${prefix}${entry.title}: ${entry.content}`;
  }

  // ── Internal ───────────────────────────────────────────────

  // ── Internal ───────────────────────────────────────────────

  /**
   * D7 按需物化路径：候选只经 index 元数据过滤/排序/截断——被过滤排除与
   * budget 截断掉的溢出候选全文零读取，最终返回子集才经 materializeByIndex 回读
   * （漂移错误与 list 同一正本）。tokenCount 写入时已按 estimateTokens 两次 ceil
   * 口径算好，tokensUsed 与兼容路径逐字相等。
   *
   * 返回 undefined = 走兼容路径：store 未提供 materializeByIndex（外部自定义 store）
   * 或过滤后候选存在无 tokenCount 的旧格式条目（readIndex 会打一行 rebuildIndex 提示）。
   */
  private queryFromIndex(
    filter: QueryFilter,
    budget: QueryBudget,
  ): { entries: KnowledgeEntry[]; tokensUsed: number; truncated: boolean } | undefined {
    const materialize = this.store.materializeByIndex;
    if (typeof materialize !== 'function') return undefined;

    const filtered = filterIndexEntries(this.store.readIndex(), filter);
    if (!filtered.every(e => indexEntryTokenCount(e) !== undefined)) return undefined;

    // 排序口径与 sortEntries 一致：maturity desc → lastReferenced desc
    const sorted = [...filtered].sort((a, b) => {
      const maturityDiff = MATURITY_RANK[b.maturity] - MATURITY_RANK[a.maturity];
      if (maturityDiff !== 0) return maturityDiff;
      return (b.lastReferenced || '').localeCompare(a.lastReferenced || '');
    });

    const picked: IndexEntry[] = [];
    let tokensUsed = 0;
    for (const entry of sorted) {
      if (picked.length >= budget.maxEntries) break;
      const entryTokens = indexEntryTokenCount(entry);
      if (entryTokens === undefined) break; // 候选全带 tokenCount 已由上方 every 闸保证
      if (tokensUsed + entryTokens > budget.maxTokens) break;
      picked.push(entry);
      tokensUsed += entryTokens;
    }

    const entries = materialize.call(this.store, picked);
    return { entries, tokensUsed, truncated: picked.length < sorted.length };
  }

  private sortEntries(entries: KnowledgeEntry[]): KnowledgeEntry[] {
    return [...entries].sort((a, b) => {
      // Primary: maturity descending
      const maturityDiff = MATURITY_RANK[b.maturity] - MATURITY_RANK[a.maturity];
      if (maturityDiff !== 0) return maturityDiff;
      // Secondary: lastReferenced descending (most recently used first)
      return (b.lastReferenced || '').localeCompare(a.lastReferenced || '');
    });
  }

  private applyBudget(
    entries: KnowledgeEntry[],
    budget: QueryBudget,
  ): { entries: KnowledgeEntry[]; tokensUsed: number; truncated: boolean } {
    const result: KnowledgeEntry[] = [];
    let tokensUsed = 0;

    for (const entry of entries) {
      if (result.length >= budget.maxEntries) break;

      const entryTokens = this.estimateTokens(entry.content) + this.estimateTokens(entry.title);
      if (tokensUsed + entryTokens > budget.maxTokens) break;

      result.push(entry);
      tokensUsed += entryTokens;
    }

    return {
      entries: result,
      tokensUsed,
      truncated: result.length < entries.length,
    };
  }

  private cacheKey(budget: QueryBudget, filter?: QueryFilter): string {
    return JSON.stringify({ budget, filter });
  }

  /** Filter entries by keyword overlap with text. Returns sorted by relevance. */
  private filterByText(entries: KnowledgeEntry[], text: string): KnowledgeEntry[] {
    const keywords = text.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    if (keywords.length === 0) return entries;

    const scored = entries.map(entry => {
      const haystack = `${entry.title} ${entry.content}`.toLowerCase();
      const score = keywords.filter(k => haystack.includes(k)).length;
      return { entry, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.entry);
  }
}
