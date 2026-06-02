/**
 * Knowledge Lifecycle Manager
 *
 * Handles maturity promotion, auto-decay, and reference tracking
 * for the knowledge flywheel.
 */

import type {
  KnowledgeEntry,
  MaturityLevel,
  MaturityChange,
  DecayConfig,
} from './types';
import { DEFAULT_DECAY_CONFIG } from './types';
import { KnowledgeStore } from './store';

const MAX_REFERENCED_BY = 20;
const MIN_CONTENT_FOR_PROVEN = 100;
const TEST_ID_PATTERN = /^(test-|inj-test)/;

// ── Lifecycle ──────────────────────────────────────────────

export interface ConsumptionEvent {
  entryId: string;
  contributor: string;
  timestamp: string;
  context?: string;
  success?: boolean;
}

export class KnowledgeLifecycle {
  private store: KnowledgeStore;
  private config: DecayConfig;
  private onReferenceCallbacks: Array<(event: ConsumptionEvent) => void> = [];

  constructor(store: KnowledgeStore, config?: Partial<DecayConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_DECAY_CONFIG, ...config };
  }

  /** Register a callback fired on every recordReference() call */
  onReference(callback: (event: ConsumptionEvent) => void): void {
    this.onReferenceCallbacks.push(callback);
  }

  /**
   * Record that an entry was referenced.
   * Updates lastReferenced timestamp, contributors, and referencedBy.
   * Optionally records execution success/failure.
   */
  recordReference(entryId: string, contributor?: string, success?: boolean, source?: 'human' | 'auto'): KnowledgeEntry | undefined {
    const entry = this.store.get(entryId);
    if (!entry) return undefined;

    const now = new Date().toISOString();
    const contributors = contributor && !entry.contributors.includes(contributor)
      ? [...entry.contributors, contributor]
      : entry.contributors;

    const refKey = `${contributor || 'unknown'}:${now.slice(0, 10)}`;
    const execSource = source || (contributor?.startsWith('auto-') ? 'auto' : undefined);

    // B4: Skip file write if this refKey already exists (same-day, same contributor)
    if (entry.referencedBy.includes(refKey)) {
      // But still record execution result if provided
      if (success !== undefined) {
        const executionResults = [
          ...(entry.executionResults || []),
          { contributor: contributor || 'unknown', success, timestamp: now, source: execSource },
        ].slice(-MAX_REFERENCED_BY);
        this.store.update(entryId, { executionResults });
      }
      return entry;
    }

    const referencedBy = [...entry.referencedBy, refKey].slice(-MAX_REFERENCED_BY);
    const executionResults = success !== undefined
      ? [...(entry.executionResults || []), { contributor: contributor || 'unknown', success, timestamp: now, source: execSource }].slice(-MAX_REFERENCED_BY)
      : entry.executionResults;

    const updated = this.store.update(entryId, {
      lastReferenced: now,
      contributors,
      referencedBy,
      executionResults,
    });

    // Fire consumption event callbacks
    for (const cb of this.onReferenceCallbacks) {
      try {
        cb({ entryId, contributor: contributor || 'unknown', timestamp: now, success });
      } catch { /* non-blocking */ }
    }

    return updated;
  }

  /**
   * Check if an entry meets promotion criteria.
   * Returns the target maturity level if promotion is warranted, otherwise undefined.
   *
   * Rules:
   * - draft → verified: lastReferenced is set AND content >= 50 chars
   * - verified → proven: two paths
   *   A) Multi-project: contributors >= 3 AND projects >= 2
   *   B) Single-project: referencedBy >= 3 AND sourceReferences from 2+ distinct workflows
   */
  checkPromotion(entryId: string): MaturityLevel | undefined {
    const entry = this.store.get(entryId);
    if (!entry) return undefined;

    // RC2: block test entries from any promotion
    if (TEST_ID_PATTERN.test(entryId)) return undefined;

    switch (entry.maturity) {
      case 'draft':
        // GAP-11: content quality gate — require >= 50 chars for promotion
        if (entry.lastReferenced && entry.content.trim().length >= 50) return 'verified';
        return undefined;

      case 'verified': {
        // RC2: content quality gate for proven promotion
        if (entry.content.trim().length < MIN_CONTENT_FOR_PROVEN) return undefined;

        // Path C: execution success rate (result-based)
        // Prefer human-sourced results when available
        const humanRate = this.getHumanSuccessRate(entryId);
        if (humanRate && humanRate.total >= 3 && humanRate.rate >= 0.8) {
          return 'proven';
        }
        // Fall back to overall rate (auto-only or mixed)
        const execRate = this.getExecutionSuccessRate(entryId);
        if (execRate && execRate.total >= 3 && execRate.rate >= 0.8) {
          return 'proven';
        }

        // Path A: multi-project validation
        if (entry.contributors.length >= 3 && entry.projects.length >= 2) {
          return 'proven';
        }
        // Path B: single-project — multiple independent references from different sources
        const refCount = entry.referencedBy?.length || 0;
        const distinctSources = new Set(entry.sourceReferences?.map(s => s.workflow).filter(Boolean) || []);
        if (refCount >= 3 && distinctSources.size >= 2) {
          return 'proven';
        }
        return undefined;
      }

      case 'proven':
      case 'archived':
        return undefined;
    }
  }

  /**
   * Check if an entry should decay based on time since last reference.
   * Returns the target maturity level if decay is warranted, otherwise undefined.
   */
  checkEntryDecay(entryId: string): MaturityLevel | undefined {
    const entry = this.store.get(entryId);
    if (!entry) return undefined;

    const lastRef = entry.lastReferenced || entry.created;
    if (!lastRef) return undefined;

    const monthsSinceRef = this.monthsSince(lastRef);

    switch (entry.maturity) {
      case 'proven':
        if (monthsSinceRef >= this.config.provenDecayMonths) return 'verified';
        return undefined;

      case 'verified':
        if (monthsSinceRef >= this.config.verifiedDecayMonths) return 'draft';
        return undefined;

      case 'draft':
        if (monthsSinceRef >= this.config.draftDecayMonths) return 'archived';
        return undefined;

      case 'archived':
        return undefined;
    }
  }

  /**
   * Run a full decay cycle across all entries.
   * Returns a list of maturity changes that were applied.
   */
  runDecayCycle(): MaturityChange[] {
    const entries = this.store.list({ excludeArchived: false });
    const changes: MaturityChange[] = [];

    for (const entry of entries) {
      const targetMaturity = this.checkEntryDecay(entry.id);
      if (targetMaturity && targetMaturity !== entry.maturity) {
        const change: MaturityChange = {
          entryId: entry.id,
          from: entry.maturity,
          to: targetMaturity,
          reason: `Auto-decay: ${entry.maturity} → ${targetMaturity} (unreferenced for threshold)`,
        };
        this.store.update(entry.id, { maturity: targetMaturity });
        changes.push(change);
      }
    }

    return changes;
  }

  /**
   * Promote an entry if it meets criteria. Returns the change if applied.
   */
  tryPromote(entryId: string): MaturityChange | undefined {
    const entry = this.store.get(entryId);
    if (!entry) return undefined;

    const target = this.checkPromotion(entryId);
    if (!target || target === entry.maturity) return undefined;

    const change: MaturityChange = {
      entryId,
      from: entry.maturity,
      to: target,
      reason: `Promotion: ${entry.maturity} → ${target}`,
    };
    this.store.update(entryId, { maturity: target });
    return change;
  }

  /**
   * Check if a source should auto-promote to verified on ingest.
   * Used by KnowledgeBus to decide initial maturity level.
   */
  shouldAutoPromote(source: string): boolean {
    return this.config.autoPromoteSources.some(s => source.includes(s));
  }

  /**
   * Get execution success rate for an entry.
   * Returns { rate, total } or undefined if no execution data.
   */
  getExecutionSuccessRate(entryId: string): { rate: number; total: number } | undefined {
    const entry = this.store.get(entryId);
    if (!entry || !entry.executionResults || entry.executionResults.length === 0) return undefined;
    const total = entry.executionResults.length;
    const successes = entry.executionResults.filter(r => r.success).length;
    return { rate: successes / total, total };
  }

  /**
   * Get execution success rate for human-sourced results only.
   * Returns { rate, total } or undefined if no human execution data.
   */
  getHumanSuccessRate(entryId: string): { rate: number; total: number } | undefined {
    const entry = this.store.get(entryId);
    if (!entry || !entry.executionResults || entry.executionResults.length === 0) return undefined;
    const humanResults = entry.executionResults.filter(r => r.source === 'human');
    if (humanResults.length === 0) return undefined;
    const total = humanResults.length;
    const successes = humanResults.filter(r => r.success).length;
    return { rate: successes / total, total };
  }

  // ── Internal ───────────────────────────────────────────────

  private monthsSince(dateStr: string): number {
    const then = new Date(dateStr);
    const now = new Date();
    return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  }
}
