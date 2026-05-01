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
    const existing = this.findDuplicate(entry.title, entry.type);
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
      lastReferenced: partial.lastReferenced || '',
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

  private findDuplicate(title: string, type: KnowledgeType): KnowledgeEntry | undefined {
    const all = this.store.list({ types: [type] });
    return all.find(e => e.title.toLowerCase() === title.toLowerCase());
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
      sourceReferences: [...existing.sourceReferences, ...incoming.sourceReferences],
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
