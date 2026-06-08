/**
 * Knowledge Query Engine
 *
 * Budget-aware query layer over KnowledgeStore.
 * Supports filtering, sorting by maturity, and result caching.
 */

import type {
  KnowledgeEntry,
  KnowledgeType,
  MaturityLevel,
  ConsumptionMode,
  StorageLayer,
  QueryBudget,
  QueryResult,
  QueryFilter,
  IndexEntry,
} from './types';
import type { KnowledgeStore } from './store';
import { KnowledgeLifecycle } from './lifecycle';

// ── Constants ──────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
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

    const candidates = this.store.list(mergedFilter);
    const sorted = this.sortEntries(candidates);
    const { entries, tokensUsed, truncated } = this.applyBudget(sorted, budget);

    const result: QueryResult = { entries, tokensUsed, truncated, fromCache: false };
    this.cache.set(cacheKey, { result, timestamp: Date.now() });

    // P2a: Record references for all returned entries (drives maturity ladder)
    for (const entry of entries) {
      try {
        this.lifecycle.recordReference(entry.id);
      } catch { /* non-blocking */ }
    }

    return result;
  }

  /**
   * Estimate token count for a piece of text.
   * Rule of thumb: 1 CJK char ≈ 2 tokens, 1 ASCII char ≈ 0.25 tokens.
   */
  estimateTokens(text: string): number {
    let tokens = 0;
    for (const ch of text) {
      // CJK Unified Ideographs + common CJK ranges
      if (/[一-鿿㐀-䶿豈-﫿]/.test(ch)) {
        tokens += 2;
      } else {
        tokens += 0.25;
      }
    }
    return Math.ceil(tokens);
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
    const rules = this.queryByMode('rule');

    const allRefs = this.queryByMode('reference');
    const references = taskContext.requirementText
      ? this.filterByText(allRefs, taskContext.requirementText).slice(0, 3)
      : allRefs.slice(0, 3);

    const allContext = this.queryByMode('context');
    const context = taskContext.phase
      ? allContext.filter(e => e.applicablePhases.includes(taskContext.phase!))
      : allContext;

    return { rules, references, context };
  }

  /**
   * Format entry for prompt injection.
   * Adds [External Source] warning prefix for external-origin entries.
   */
  static formatForPrompt(entry: KnowledgeEntry): string {
    const prefix = entry.origin === 'external'
      ? '[External Source — verify before acting]\n'
      : '';
    return `${prefix}${entry.title}: ${entry.content}`;
  }

  // ── Internal ───────────────────────────────────────────────

  // ── Internal ───────────────────────────────────────────────

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
