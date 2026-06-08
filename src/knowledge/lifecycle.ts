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
import type { KnowledgeStore } from './store';

const MAX_REFERENCED_BY = 20;
const MIN_CONTENT_FOR_PROVEN = 100;
const TEST_ID_PATTERN = /^(test-|inj-test)/;
const SIGNAL_SATURATION_THRESHOLD = 3;
const CONTEXT_DECAY_MONTHS = 3;
const RULE_MIN_RESULTS_FOR_DECAY = 3;
const RULE_FAIL_THRESHOLD = 0.5;

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
   * Branches by consumptionMode:
   * - rule: draft→active (1 success execution)
   * - reference: draft→verified→proven (existing logic)
   * - context: draft→active (1 reference)
   * - signal: no promotion
   */
  checkPromotion(entryId: string): MaturityLevel | undefined {
    const entry = this.store.get(entryId);
    if (!entry) return undefined;

    // RC2: block test entries from any promotion
    if (TEST_ID_PATTERN.test(entryId)) return undefined;

    const mode = entry.consumptionMode || 'reference';

    switch (mode) {
      case 'rule':      return this.checkRulePromotion(entry);
      case 'context':   return this.checkContextPromotion(entry);
      case 'signal':    return undefined; // signal never promotes
      case 'reference': return this.checkReferencePromotion(entry);
    }
  }

  /**
   * Check if an entry should decay.
   * Returns the target maturity level if decay is warranted, otherwise undefined.
   *
   * - decayAt hard expiry takes precedence (all modes)
   * - Then branches by consumptionMode for mode-specific decay
   */
  checkEntryDecay(entryId: string): MaturityLevel | undefined {
    const entry = this.store.get(entryId);
    if (!entry) return undefined;

    // decayAt hard expiry — all modes, highest priority
    if (entry.decayAt && new Date(entry.decayAt) <= new Date()) {
      return 'archived';
    }

    const mode = entry.consumptionMode || 'reference';

    switch (mode) {
      case 'rule':      return this.checkRuleDecay(entry);
      case 'reference': return this.checkReferenceDecay(entry);
      case 'context':   return this.checkContextDecay(entry);
      case 'signal':    return this.checkSignalDecay(entry);
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

  // ── Per-mode promotion ─────────────────────────────────────

  /** rule: draft→active with 1 success execution */
  private checkRulePromotion(entry: KnowledgeEntry): MaturityLevel | undefined {
    if (entry.maturity !== 'draft') return undefined;
    const rate = this.getExecutionSuccessRate(entry.id);
    if (rate && rate.total >= 1 && rate.rate >= 1.0) return 'active';
    return undefined;
  }

  /** reference: draft→verified→proven (existing logic) */
  private checkReferencePromotion(entry: KnowledgeEntry): MaturityLevel | undefined {
    switch (entry.maturity) {
      case 'draft':
        if (entry.lastReferenced && entry.content.trim().length >= 50) return 'verified';
        return undefined;

      case 'verified': {
        if (entry.content.trim().length < MIN_CONTENT_FOR_PROVEN) return undefined;
        const humanRate = this.getHumanSuccessRate(entry.id);
        if (humanRate && humanRate.total >= 3 && humanRate.rate >= 0.8) return 'proven';
        const execRate = this.getExecutionSuccessRate(entry.id);
        if (execRate && execRate.total >= 3 && execRate.rate >= 0.8) return 'proven';
        if (entry.contributors.length >= 3 && entry.projects.length >= 2) return 'proven';
        const refCount = entry.referencedBy?.length || 0;
        const distinctSources = new Set(entry.sourceReferences?.map(s => s.workflow).filter(Boolean) || []);
        if (refCount >= 3 && distinctSources.size >= 2) return 'proven';
        return undefined;
      }

      default:
        return undefined;
    }
  }

  /** context: draft→active with 1 reference */
  private checkContextPromotion(entry: KnowledgeEntry): MaturityLevel | undefined {
    if (entry.maturity !== 'draft') return undefined;
    if (entry.referencedBy.length >= 1) return 'active';
    return undefined;
  }

  // ── Per-mode decay ─────────────────────────────────────────

  /** rule: active→deprecated when fail rate >= 50% with 3+ results */
  private checkRuleDecay(entry: KnowledgeEntry): MaturityLevel | undefined {
    if (entry.maturity !== 'active') return undefined;
    const rate = this.getExecutionSuccessRate(entry.id);
    if (rate && rate.total >= RULE_MIN_RESULTS_FOR_DECAY && rate.rate < RULE_FAIL_THRESHOLD) return 'deprecated';
    return undefined;
  }

  /** reference: proven→verified→draft→archived by time (existing logic) */
  private checkReferenceDecay(entry: KnowledgeEntry): MaturityLevel | undefined {
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
      default:
        return undefined;
    }
  }

  /** context: active→archived after CONTEXT_DECAY_MONTHS unreferenced */
  private checkContextDecay(entry: KnowledgeEntry): MaturityLevel | undefined {
    if (entry.maturity !== 'active') return undefined;
    const lastRef = entry.lastReferenced || entry.created;
    if (!lastRef) return undefined;
    if (this.monthsSince(lastRef) >= CONTEXT_DECAY_MONTHS) return 'archived';
    return undefined;
  }

  /**
   * signal: active→archived by consumption saturation.
   * Saturated = referencedBy >= threshold AND newer same-tag signal entry exists.
   */
  private checkSignalDecay(entry: KnowledgeEntry): MaturityLevel | undefined {
    if (entry.maturity !== 'active') return undefined;
    const refCount = entry.referencedBy?.length || 0;
    if (refCount < SIGNAL_SATURATION_THRESHOLD) return undefined;

    const newer = this.store.list({
      tags: entry.tags,
      excludeArchived: false,
    }).find(e =>
      e.id !== entry.id &&
      (e.consumptionMode || 'reference') === 'signal' &&
      e.created > entry.created
    );
    if (newer) return 'archived';
    return undefined;
  }

  // ── Internal ───────────────────────────────────────────────

  private monthsSince(dateStr: string): number {
    const then = new Date(dateStr);
    const now = new Date();
    return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  }
}
