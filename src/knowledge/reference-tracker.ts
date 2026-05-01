/**
 * Reference Tracker
 *
 * Tracks which decisions reference which knowledge entries.
 * Storage: append-only JSONL at .harness/knowledge/references.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ReferenceRecord } from './types';
import { KnowledgeStore } from './store';

const REFERENCES_FILE = 'references.jsonl';

// ── Reference Tracker ──────────────────────────────────────

export class ReferenceTracker {
  private filePath: string;
  private store: KnowledgeStore;

  constructor(store: KnowledgeStore, baseDir?: string) {
    const dir = baseDir || '.harness/knowledge';
    this.filePath = path.join(dir, REFERENCES_FILE);
    this.store = store;
  }

  /**
   * Record that a decision referenced a set of knowledge entries.
   */
  record(decisionId: string, entryIds: string[]): void {
    const record: ReferenceRecord = {
      decisionId,
      entryIds,
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf-8');
  }

  /**
   * Get all decision IDs that referenced a given entry.
   */
  getReferencesForEntry(entryId: string): string[] {
    const records = this.readAll();
    return records
      .filter(r => r.entryIds.includes(entryId))
      .map(r => r.decisionId);
  }

  /**
   * Get all entry IDs referenced by a given decision.
   */
  getReferencesForDecision(decisionId: string): string[] {
    const records = this.readAll();
    const record = records.find(r => r.decisionId === decisionId);
    return record ? record.entryIds : [];
  }

  /**
   * Batch-update referencedBy fields on all knowledge entries.
   * Scans all reference records and populates entry.referencedBy.
   */
  updateReferencedBy(): void {
    const records = this.readAll();
    const entryToDecisions = new Map<string, Set<string>>();

    for (const record of records) {
      for (const entryId of record.entryIds) {
        if (!entryToDecisions.has(entryId)) {
          entryToDecisions.set(entryId, new Set());
        }
        entryToDecisions.get(entryId)!.add(record.decisionId);
      }
    }

    for (const [entryId, decisions] of entryToDecisions) {
      const entry = this.store.get(entryId);
      if (entry) {
        this.store.update(entryId, {
          referencedBy: [...decisions],
        });
      }
    }
  }

  // ── Internal ───────────────────────────────────────────────

  private readAll(): ReferenceRecord[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as ReferenceRecord);
    } catch {
      return [];
    }
  }
}
