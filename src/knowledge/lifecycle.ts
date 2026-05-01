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

// ── Lifecycle ──────────────────────────────────────────────

export class KnowledgeLifecycle {
  private store: KnowledgeStore;
  private config: DecayConfig;

  constructor(store: KnowledgeStore, config?: Partial<DecayConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_DECAY_CONFIG, ...config };
  }

  /**
   * Record that an entry was referenced.
   * Updates lastReferenced timestamp and contributors.
   */
  recordReference(entryId: string, contributor?: string): KnowledgeEntry | undefined {
    const entry = this.store.get(entryId);
    if (!entry) return undefined;

    const now = new Date().toISOString();
    const contributors = contributor && !entry.contributors.includes(contributor)
      ? [...entry.contributors, contributor]
      : entry.contributors;

    return this.store.update(entryId, {
      lastReferenced: now,
      contributors,
    });
  }

  /**
   * Check if an entry meets promotion criteria.
   * Returns the target maturity level if promotion is warranted, otherwise undefined.
   *
   * Rules:
   * - draft → verified: lastReferenced is set (referenced at least once)
   * - verified → proven: referenced ≥3 times (contributors count as proxy) + ≥2 projects
   */
  checkPromotion(entryId: string): MaturityLevel | undefined {
    const entry = this.store.get(entryId);
    if (!entry) return undefined;

    switch (entry.maturity) {
      case 'draft':
        if (entry.lastReferenced) return 'verified';
        return undefined;

      case 'verified':
        if (entry.contributors.length >= 3 && entry.projects.length >= 2) {
          return 'proven';
        }
        return undefined;

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

  // ── Internal ───────────────────────────────────────────────

  private monthsSince(dateStr: string): number {
    const then = new Date(dateStr);
    const now = new Date();
    return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  }
}
