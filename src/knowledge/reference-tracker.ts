/**
 * Reference Tracker
 *
 * Tracks which decisions reference which knowledge entries.
 * Storage: append-only JSONL at .harness/knowledge/references.jsonl
 */

import * as path from 'path';
import { appendJsonl, readJsonl } from '../utils/jsonl';
import type { ReferenceRecord } from './types';
import type { KnowledgeStore } from './store';

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
    // 写链收口：ensureDir + append（harness#82；原实现不 ensureDir，依赖 store 建目录）
    appendJsonl(this.filePath, record);
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
    try {
      // 坏行策略：skip（harness#82：原「逐行 map 会抛 + 外层 catch 吞成整文件 []」
      // ——坏一行丢全部记录——不可接受，改为单行损坏只丢该行）；
      // 外层 catch 仅兜 IO 读取错误，沿用原吞掉语义
      return readJsonl<ReferenceRecord>(this.filePath, 'skip').records;
    } catch {
      return [];
    }
  }
}
