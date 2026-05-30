/**
 * Knowledge Ingest Pipeline
 *
 * Handles ingesting new knowledge entries into the store
 * with auto-fill, dedup detection, and batch support.
 */

import type {
  KnowledgeEntry,
  KnowledgeType,
  MaturityLevel,
  IngestOptions,
  SourceRef,
} from './types';
import { KnowledgeStore } from './store';

const MAX_SOURCE_REFS = 20;

// ── Ingest ─────────────────────────────────────────────────

export class KnowledgeIngest {
  private store: KnowledgeStore;

  constructor(store: KnowledgeStore) {
    this.store = store;
  }

  /**
   * Ingest a single knowledge entry.
   * Auto-fills id, created, maturity, and other defaults.
   * Returns the fully-formed entry that was saved.
   */
  ingestEntry(
    partial: Partial<KnowledgeEntry>,
    options: IngestOptions,
  ): KnowledgeEntry {
    const entry = this.buildEntry(partial, options);

    // Dedup check: same title + same type
    const existing = this.findDuplicate(entry.title, entry.content, entry.type);
    if (existing) {
      // Merge: update existing entry with new content and metadata
      return this.mergeEntries(existing, entry, options);
    }

    this.store.save(entry);
    return entry;
  }

  /**
   * Ingest multiple entries in batch.
   * Returns all ingested entries.
   */
  ingestBatch(
    partials: Partial<KnowledgeEntry>[],
    options: IngestOptions,
  ): KnowledgeEntry[] {
    return partials.map(p => this.ingestEntry(p, options));
  }

  // ── Internal ───────────────────────────────────────────────

  private buildEntry(
    partial: Partial<KnowledgeEntry>,
    options: IngestOptions,
  ): KnowledgeEntry {
    const now = new Date().toISOString();
    const type = partial.type || this.inferType(options);
    const id = partial.id || this.generateId(type);

    return {
      id,
      type,
      title: partial.title || 'Untitled',
      content: partial.content || '',
      maturity: options.maturity || partial.maturity || 'draft',
      layer: options.layer,
      created: partial.created || now,
      lastReferenced: partial.lastReferenced || now,
      contributors: partial.contributors || [],
      projects: partial.projects || options.projects || [],
      tags: [...new Set([...(partial.tags || []), ...(options.tags || [])])],
      applicablePhases: partial.applicablePhases || [],
      sourceReferences: partial.sourceReferences || this.defaultSourceRef(options.source),
      referencedBy: partial.referencedBy || [],
    };
  }

  private generateId(type: KnowledgeType): string {
    const prefix = type.toUpperCase().slice(0, 3);
    const existing = this.store.list({ types: [type] });
    const seq = String(existing.length + 1).padStart(3, '0');
    return `${prefix}-${seq}`;
  }

  private inferType(options: IngestOptions): KnowledgeType {
    // Default to 'guideline' if type can't be inferred
    return 'guideline';
  }

  private findDuplicate(title: string, content: string, type: KnowledgeType): KnowledgeEntry | undefined {
    // A1: Read from disk directly to avoid stale index causing dedup failure
    const all = this.store.readEntriesFromDisk().filter(e => e.type === type);

    // Exact match (case-insensitive)
    const exact = all.find(e => e.title.toLowerCase() === title.toLowerCase());
    if (exact) return exact;

    // Pitfall-aware dedup: same root cause, different title wording
    if (type === 'pitfall') {
      return this.findPitfallDuplicate(title, content, all);
    }

    return undefined;
  }

  /**
   * Pitfall dedup: detect same root cause with different title wording.
   * Signal priority: content prefix > title substring > title keyword overlap.
   */
  private findPitfallDuplicate(title: string, content: string, entries: KnowledgeEntry[]): KnowledgeEntry | undefined {
    const normalized = this.normalizeForDedup(title);
    const contentPrefix = this.getContentPrefix(content);

    for (const entry of entries) {
      const entryNorm = this.normalizeForDedup(entry.title);

      // 1. Content prefix match (first 50 chars — shared root cause description)
      if (contentPrefix.length >= 30) {
        const entryPrefix = this.getContentPrefix(entry.content);
        if (entryPrefix.length >= 30 && contentPrefix === entryPrefix) return entry;
      }

      // 2. Title substring match after normalization
      if (normalized.length >= 6 && entryNorm.length >= 6) {
        if (normalized.includes(entryNorm) || entryNorm.includes(normalized)) {
          return entry;
        }
      }

      // 3. Title keyword overlap >= 60%
      if (this.titleOverlap(normalized, entryNorm) >= 0.6) {
        return entry;
      }
    }

    return undefined;
  }

  /** Strip [prefix] tags and normalize for comparison */
  private normalizeForDedup(title: string): string {
    const t = title.replace(/^\[.*?\]\s*/g, '').trim();
    // Keep spaces between character types (Latin/Chinese boundary) for tokenization
    return t.replace(/[，。、：；！？]/g, '').toLowerCase();
  }

  /** Extract first 50 chars of content body (after frontmatter), stripped of whitespace */
  private getContentPrefix(content: string): string {
    // Strip YAML frontmatter (may be nested if content includes raw markdown)
    const body = content.replace(/^---[\s\S]*?---\n?/, '').trim();
    return body.slice(0, 50).replace(/\s+/g, '');
  }

  /** Calculate keyword overlap ratio between two normalized titles */
  private titleOverlap(a: string, b: string): number {
    // Extract Chinese characters as individual tokens + Latin words
    const tokenize = (s: string): string[] => {
      const chinese = [...s.matchAll(/\p{Script=Han}/gu)].map(m => m[0]);
      const latin = s.match(/[a-z0-9]{2,}/g) || [];
      return [...chinese, ...latin];
    };
    const tokensA = tokenize(a);
    const tokensB = tokenize(b);
    if (tokensA.length === 0 || tokensB.length === 0) return 0;
    const setB = new Set(tokensB);
    const overlap = tokensA.filter(t => setB.has(t)).length;
    return overlap / Math.max(tokensA.length, tokensB.length);
  }

  private mergeEntries(
    existing: KnowledgeEntry,
    incoming: KnowledgeEntry,
    options: IngestOptions,
  ): KnowledgeEntry {
    const merged: Partial<KnowledgeEntry> = {
      content: incoming.content || existing.content,
      lastReferenced: new Date().toISOString(),
      contributors: [...new Set([...existing.contributors, ...incoming.contributors])],
      projects: [...new Set([...existing.projects, ...incoming.projects])],
      tags: [...new Set([...existing.tags, ...incoming.tags])],
      sourceReferences: [...existing.sourceReferences, ...incoming.sourceReferences].slice(-MAX_SOURCE_REFS),
    };
    return this.store.update(existing.id, merged)!;
  }

  private defaultSourceRef(source: string): SourceRef[] {
    return [{
      workflow: source,
      timestamp: new Date().toISOString(),
    }];
  }
}
