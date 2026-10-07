/**
 * Knowledge Ingest Pipeline
 *
 * Handles ingesting new knowledge entries into the store
 * with auto-fill, dedup detection, and batch support.
 */

import type {
  KnowledgeEntry,
  KnowledgeSubsystem,
  IngestOptions,
  SourceRef,
} from './types';
import { MATURITY_LEVELS, STORAGE_LAYERS } from './types';
import type { KnowledgeStore } from './store';
import { KnowledgeAudit } from './audit';
import { MAX_SOURCE_REFS } from './audit-rules';
import { splitFrontmatter } from '../utils/frontmatter';

/**
 * `validateEntry` 的一条摄入前校验问题（lint.ts 删除后的保种落点，ADR-0040 Phase 4）。
 * severity='high' 按阻断处理（拒收），其余为提示。
 */
export interface IngestValidationIssue {
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion: string;
}

/**
 * `ingestEntry` / `ingestBatch` 的返回（判别联合）：
 * - `accepted`：已落盘（新建或去重合并），`entry` 为最终形态
 * - `rejected`：审计质量门拒收、未落盘，`reasons` 为逐条拒绝理由
 *
 * 原实现把 `__rejected` / `__rejectReasons` 经 `as any` 偷挂在返回条目上——
 * 类型面看不见、全仓零消费点（Phase 4 any 清零时核实），改为显式判别联合。
 */
export type IngestResult =
  | { status: 'accepted'; entry: KnowledgeEntry }
  | { status: 'rejected'; entry: KnowledgeEntry; reasons: string[] };

// ── Ingest ─────────────────────────────────────────────────

export class KnowledgeIngest {
  private store: KnowledgeStore;

  constructor(store: KnowledgeStore) {
    this.store = store;
  }

  /**
   * Ingest a single knowledge entry.
   * Auto-fills id, created, maturity, and other defaults.
   * Returns a discriminated result: accepted = saved (new or merged), rejected = audit gate refusal.
   */
  ingestEntry(
    partial: Partial<KnowledgeEntry>,
    options: IngestOptions,
  ): IngestResult {
    const entry = this.buildEntry(partial, options);

    // Quality gate: audit before saving
    const audit = new KnowledgeAudit(this.store);
    let issues = audit.validate(entry);
    const critical = issues.filter(i => i.action === 'reject');
    if (critical.length > 0) {
      // Reject: return without saving; caller branches on status / reasons
      return { status: 'rejected', entry, reasons: critical.map(i => i.detail) };
    }

    // If caller explicitly set maturity, skip demote actions from audit.
    // Demote is for auto-inferred maturity that's too high; explicit is a user decision.
    if (options.maturity) {
      issues = issues.filter(i => i.action !== 'demote');
    }

    // Dedup check: same title + same type
    const existing = this.findDuplicate(entry.title, entry.content, entry.type);
    if (existing) {
      // Merge: update existing entry with new content and metadata
      return { status: 'accepted', entry: this.mergeEntries(existing, entry, options) };
    }

    this.store.save(entry);

    // Post-save: apply auto-fixes (archive/demote/flag)
    const fixable = issues.filter(i => i.action !== 'reject');
    if (fixable.length > 0) {
      for (const issue of fixable) {
        if (issue.action === 'archive') {
          this.store.update(entry.id, { maturity: 'archived' });
        } else if (issue.action === 'demote') {
          this.store.update(entry.id, { maturity: 'draft' });
        } else if (issue.action === 'flag') {
          const saved = this.store.get(entry.id);
          if (saved && !saved.tags.includes('low_quality')) {
            this.store.update(entry.id, { tags: [...saved.tags, 'low_quality'] });
          }
        }
      }
    }

    return { status: 'accepted', entry };
  }

  /**
   * Ingest multiple entries in batch.
   * Returns one result per input (accepted/rejected).
   */
  ingestBatch(
    partials: Partial<KnowledgeEntry>[],
    options: IngestOptions,
  ): IngestResult[] {
    return partials.map(p => this.ingestEntry(p, options));
  }

  /**
   * 摄入前单条校验（KnowledgeLinter.validateEntry 的保种落点，ADR-0040 Phase 4；
   * 原 lint.ts 随 audit 正本收口删除）。返回空数组 = 可摄入。
   *
   * 检查项：
   * - maturity/layer 未声明枚举值 → high（字段缺省跳过，兼容只传四字段的
   *   pre-ingest 调用方；存量枚举扫描由 audit 覆盖）
   * - content < 20 字符 → high（疑似 LLM 幻觉，拒收）
   * - title 过于宽泛（只有症状词）→ medium
   * - 与同 type、共享 ≥2 tag 的 proven 条目矛盾风险 → high
   * - 与存量条目标题精确重复 / 互相包含 → medium / low
   */
  validateEntry(entry: { title: string; content: string; tags: string[]; type: string; maturity?: string; layer?: string }): IngestValidationIssue[] {
    const issues: IngestValidationIssue[] = [];

    // 未声明枚举值（字段缺省跳过）
    if (entry.maturity !== undefined && !(MATURITY_LEVELS as readonly string[]).includes(entry.maturity)) {
      issues.push({
        severity: 'high',
        description: `maturity "${entry.maturity}" is not a declared value (${MATURITY_LEVELS.join(' | ')}).`,
        suggestion: 'Map to a declared maturity (e.g. pending → draft) before writing; the store write gate rejects undeclared values.',
      });
    }
    if (entry.layer !== undefined && !(STORAGE_LAYERS as readonly string[]).includes(entry.layer)) {
      issues.push({
        severity: 'high',
        description: `layer "${entry.layer}" is not a declared value (${STORAGE_LAYERS.join(' | ')}).`,
        suggestion: 'Map to a declared layer or drop the field; the store write gate rejects undeclared values.',
      });
    }

    // Content too short
    if ((entry.content || '').length < 20) {
      issues.push({
        severity: 'high',
        description: `Content too short (${entry.content.length} chars). LLM may have hallucinated.`,
        suggestion: 'Reject — re-extract with better prompt or discard.',
      });
    }

    // Title too vague
    const vaguePatterns = /^(错误|失败|问题|异常|bug|error|fail|issue|problem|unknown|untitled)$/i;
    if (vaguePatterns.test(entry.title.trim())) {
      issues.push({
        severity: 'medium',
        description: `Title "${entry.title}" is too vague to be useful.`,
        suggestion: 'Re-extract with root cause in title, not symptom.',
      });
    }

    // Contradicts proven entry with same tags
    if (entry.tags && entry.tags.length > 0) {
      const allEntries = this.store.list({ excludeArchived: false });
      for (const existing of allEntries) {
        if (existing.maturity !== 'proven') continue;
        if (existing.type !== entry.type) continue;
        const sharedTags = entry.tags.filter(t => existing.tags.includes(t));
        if (sharedTags.length >= 2) {
          issues.push({
            severity: 'high',
            description: `New entry "${entry.title}" shares tags [${sharedTags.join(', ')}] with proven entry "${existing.title}" (${existing.id}). Contradiction risk.`,
            suggestion: `Review against ${existing.id}. If aligned, merge. If contradictory, flag for human review.`,
          });
        }
      }
    }

    // Near-duplicate title check (simple: case-insensitive substring match)
    if (entry.title.length > 10) {
      const allEntries = this.store.list({ excludeArchived: false });
      for (const existing of allEntries) {
        if (existing.id === entry.title) continue; // not same entry (entry doesn't have id yet)
        const existingTitle = (existing.title || '').toLowerCase();
        const newTitle = (entry.title || '').toLowerCase();
        if (existingTitle === newTitle) {
          issues.push({
            severity: 'medium',
            description: `Exact title match with existing entry "${existing.title}" (${existing.id}).`,
            suggestion: `Merge into ${existing.id} instead of creating duplicate.`,
          });
          break;
        }
        // Check high similarity (either title contains the other)
        if (existingTitle.includes(newTitle) || newTitle.includes(existingTitle)) {
          issues.push({
            severity: 'low',
            description: `Title similarity with existing "${existing.title}" (${existing.id}).`,
            suggestion: `Consider merging with ${existing.id}.`,
          });
          break;
        }
      }
    }

    return issues;
  }

  // ── Internal ───────────────────────────────────────────────

  private buildEntry(
    partial: Partial<KnowledgeEntry>,
    options: IngestOptions,
  ): KnowledgeEntry {
    const now = new Date().toISOString();
    const type = partial.type || 'guideline';
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
      executionResults: partial.executionResults || [],
      consumptionMode: partial.consumptionMode || options.consumptionMode || 'reference',
      origin: partial.origin || options.origin || 'agent',
      fullContentPath: partial.fullContentPath || options.fullContentPath,
      skillId: partial.skillId,
    };
  }

  private generateId(type: KnowledgeSubsystem): string {
    const prefix = type.toUpperCase().slice(0, 3);
    // 序号取自索引计数（harness#107）：不再走 list() 逐条读条目文件；
    // 与 list() 默认过滤口径一致，archived/deprecated 不计入序号
    const existing = this.store.readIndex()
      .filter(e => e.type === type && e.maturity !== 'archived' && e.maturity !== 'deprecated');
    const seq = String(existing.length + 1).padStart(3, '0');
    return `${prefix}-${seq}`;
  }

  private findDuplicate(title: string, content: string, type: KnowledgeSubsystem): KnowledgeEntry | undefined {
    // A1: Read from disk directly to avoid stale index causing dedup failure
    const all = this.store.readEntriesFromDisk().filter(e => e.type === type);

    // Exact match (case-insensitive)
    const exact = all.find(e => (e.title || '').toLowerCase() === title.toLowerCase());
    if (exact) return exact;

    // Semantic dedup: content prefix + title substring + keyword overlap
    return this.findSemanticDuplicate(title, content, all);
  }

  /**
   * Semantic dedup: detect same knowledge with different title wording.
   * Signal priority: content prefix > title substring > title keyword overlap.
   */
  private findSemanticDuplicate(title: string, content: string, entries: KnowledgeEntry[]): KnowledgeEntry | undefined {
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
    const t = (title || '').replace(/^\[.*?\]\s*/g, '').trim();
    // Keep spaces between character types (Latin/Chinese boundary) for tokenization
    return t.replace(/[，。、：；！？]/g, '').toLowerCase();
  }

  /** Extract first 50 chars of content body (after frontmatter), stripped of whitespace */
  private getContentPrefix(content: string): string {
    // 正本判定（harness#89）：只有合法 frontmatter 块才剥头，正文里的 --- 分隔线不再被误吞
    const fm = splitFrontmatter(content);
    const body = fm.state === 'ok' ? fm.body : content;
    return body.trim().slice(0, 50).replace(/\s+/g, '');
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
      maturity: options.maturity || existing.maturity,
      lastReferenced: new Date().toISOString(),
      contributors: [...new Set([...existing.contributors, ...incoming.contributors])],
      projects: [...new Set([...existing.projects, ...incoming.projects])],
      tags: [...new Set([...existing.tags, ...incoming.tags])],
      sourceReferences: [...existing.sourceReferences, ...incoming.sourceReferences].slice(-MAX_SOURCE_REFS),
    };
    // fail-fast：刚经 readEntriesFromDisk 读到的条目 update 不到 = 并发删除/索引漂移，不静默吞
    const updated = this.store.update(existing.id, merged);
    if (!updated) {
      throw new Error(`mergeEntries: 条目 ${existing.id} 落盘更新失败（读得到写不回）`);
    }
    return updated;
  }

  private defaultSourceRef(source: string): SourceRef[] {
    return [{
      workflow: source,
      timestamp: new Date().toISOString(),
    }];
  }
}
