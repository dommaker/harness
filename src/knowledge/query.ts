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
  StorageLayer,
  QueryBudget,
  QueryResult,
  QueryFilter,
  IndexEntry,
} from './types';
import { KnowledgeStore } from './store';

// ── Constants ──────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MATURITY_RANK: Record<MaturityLevel, number> = {
  proven: 3,
  verified: 2,
  draft: 1,
  archived: 0,
};

// ── Cache ──────────────────────────────────────────────────

interface CacheEntry {
  result: QueryResult;
  timestamp: number;
}

// ── Query Engine ───────────────────────────────────────────

export class KnowledgeQuery {
  private store: KnowledgeStore;
  private cache = new Map<string, CacheEntry>();

  constructor(store: KnowledgeStore) {
    this.store = store;
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
}
