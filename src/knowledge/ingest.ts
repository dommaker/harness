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
  IndexEntry,
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

/**
 * D7 ingest 批内上下文（包内私有）：磁盘去重基线与虚拟序号起点惰性各读一次，
 * 本批已接受条目（新建/merge 的终态）即时进 overlay——
 * 去重视图 = 磁盘基线 + overlay；虚拟 index = 起点 + overlay 终态序号记录
 * （auto-fix 后的 maturity 即时生效，复刻旧逐条路径的序号口径）。
 * reject 不入 overlay。
 */
class IngestContext {
  private diskCache: KnowledgeEntry[] | undefined;
  private indexCache: IndexEntry[] | undefined;
  private readonly overlay: KnowledgeEntry[] = [];
  private readonly overlayIndex: Array<{ id: string; type: string; maturity: string }> = [];

  constructor(private readonly store: KnowledgeStore) {}

  /** 共享磁盘去重基线（readEntriesFromDisk 每批至多一次） */
  disk(): KnowledgeEntry[] {
    return (this.diskCache ??= this.store.readEntriesFromDisk());
  }

  /** 虚拟序号/索引状态起点（readIndex 每批至多一次） */
  index(): IndexEntry[] {
    return (this.indexCache ??= this.store.readIndex());
  }

  /** 本批已接受条目的最新状态入列；同 id 替换而非追加（stale 旧态不得残留） */
  accept(entry: KnowledgeEntry): void {
    const at = this.overlay.findIndex(e => e.id === entry.id);
    if (at >= 0) {
      this.overlay[at] = entry;
    } else {
      this.overlay.push(entry);
    }
    const record = { id: entry.id, type: entry.type, maturity: entry.maturity };
    const recAt = this.overlayIndex.findIndex(r => r.id === entry.id);
    if (recAt >= 0) {
      this.overlayIndex[recAt] = record;
    } else {
      this.overlayIndex.push(record);
    }
  }

  /**
   * 去重视图：磁盘基线中被本批更新过的 id 以 overlay 最新状态为准——
   * stale 磁盘条目不得抢在更新态前命中（同批连续 merge 第二次须基于第一次终态）；
   * 顺序语义保持盘序在前、本批接受序在后。
   */
  view(): KnowledgeEntry[] {
    const updatedIds = new Set(this.overlay.map(e => e.id));
    return [...this.disk().filter(e => !updatedIds.has(e.id)), ...this.overlay];
  }

  /** 虚拟 index：起点中被本批更新过的 id 按 overlay 终态替换（每 id 至多计一次序号） */
  virtualIndex(): Array<{ id: string; type: string; maturity: string }> {
    const updatedIds = new Set(this.overlayIndex.map(r => r.id));
    return [...this.index().filter(r => !updatedIds.has(r.id)), ...this.overlayIndex];
  }
}

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
    return this.ingestOne(partial, options, new IngestContext(this.store));
  }

  /**
   * Ingest multiple entries in batch.
   * Returns one result per input (accepted/rejected).
   *
   * D7：批内共享一次磁盘去重视图与虚拟 index 起点（IngestContext，惰性各读一次），
   * 本批已接受的新建/merge 即时纳入视图，保留批内重复语义；逐条 ingestEntry 行为不变。
   *
   * 统一落盘：新建与 merge 的完整终态（含 auto-fix 折好）收入写计划，
   * 批尾一次 saveAll——全批只重写一次 index.json，整批预校验
   * （任一脏枚举全批拒写，不制造已落盘假象）；批内同 id 按 saveAll 后写覆盖语义。
   * 空批零读写。单条路径（ingestEntry）写时序不变。
   */
  ingestBatch(
    partials: Partial<KnowledgeEntry>[],
    options: IngestOptions,
  ): IngestResult[] {
    if (partials.length === 0) return [];
    const ctx = new IngestContext(this.store);
    const plan: KnowledgeEntry[] = [];
    const results = partials.map(p => this.ingestOne(p, options, ctx, plan));
    if (plan.length > 0) {
      this.store.saveAll(plan);
    }
    return results;
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

  /**
   * 单条的批内共用执行体（D7）：build → audit.validate → reject 或
   * 视图去重 → merge / 新建 + auto-fix。ingestEntry 每调新建上下文（= 原单条行为）；
   * ingestBatch 全批共享一个上下文。
   *
   * `plan` 存在 = 批次写计划模式：新建与 merge 的完整终态收进 plan（不逐条落盘，
   * 由批尾一次 saveAll 统一写入）；缺省 = 单条即时写路径（save + 逐 fix update），
   * 写时序与旧实现逐字一致。返回值契约两种模式相同（新建返回 pre-fix entry，
   * merge 返回合并终态）。
   */
  private ingestOne(
    partial: Partial<KnowledgeEntry>,
    options: IngestOptions,
    ctx: IngestContext,
    plan?: KnowledgeEntry[],
  ): IngestResult {
    const entry = this.buildEntry(partial, options, ctx);

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

    // Dedup check: same title + same type（共享视图 = 磁盘基线 + 本批已接受终态）
    const existing = this.findDuplicate(entry.title, entry.content, entry.type, ctx.view());
    if (existing) {
      // Merge: update existing entry with new content and metadata（merge 分支不做新条目 auto-fix）
      if (plan) {
        const merged = this.computeMerge(existing, entry, options);
        plan.push(merged);
        ctx.accept(merged);
        return { status: 'accepted', entry: merged };
      }
      const merged = this.mergeEntries(existing, entry, options);
      ctx.accept(merged);
      return { status: 'accepted', entry: merged };
    }

    if (plan) {
      // 批次模式：auto-fix 折进终态收写计划，批尾一次落盘；返回值仍是 pre-fix entry
      const finalEntry = this.foldAutoFixes(entry, issues);
      plan.push(finalEntry);
      ctx.accept(finalEntry);
      return { status: 'accepted', entry };
    }

    this.store.save(entry);

    // Post-save: apply auto-fixes (archive/demote/flag)
    const finalEntry = this.persistAutoFixes(entry, issues);
    ctx.accept(finalEntry);

    return { status: 'accepted', entry };
  }

  /**
   * auto-fix 折叠（纯，D7 批次模式用）：archive/demote/flag 依 issues 顺序折进条目副本，
   * 与单条路径逐步 update 的终态一致。merge 分支不调用（既有语义）。
   */
  private foldAutoFixes(entry: KnowledgeEntry, issues: import('./audit-rules').AuditIssue[]): KnowledgeEntry {
    let current = entry;
    for (const issue of issues) {
      if (issue.action === 'archive') {
        current = { ...current, maturity: 'archived' };
      } else if (issue.action === 'demote') {
        current = { ...current, maturity: 'draft' };
      } else if (issue.action === 'flag') {
        if (!current.tags.includes('low_quality')) {
          current = { ...current, tags: [...current.tags, 'low_quality'] };
        }
      }
    }
    return current;
  }

  /** 单条即时写路径的 auto-fix：逐步 store.update（写时序与旧实现一致），返回折好终态供 overlay */
  private persistAutoFixes(entry: KnowledgeEntry, issues: import('./audit-rules').AuditIssue[]): KnowledgeEntry {
    let current = entry;
    for (const issue of issues) {
      if (issue.action === 'archive') {
        this.store.update(entry.id, { maturity: 'archived' });
        current = { ...current, maturity: 'archived' };
      } else if (issue.action === 'demote') {
        this.store.update(entry.id, { maturity: 'draft' });
        current = { ...current, maturity: 'draft' };
      } else if (issue.action === 'flag') {
        if (!current.tags.includes('low_quality')) {
          const tags = [...current.tags, 'low_quality'];
          this.store.update(entry.id, { tags });
          current = { ...current, tags };
        }
      }
    }
    return current;
  }

  private buildEntry(
    partial: Partial<KnowledgeEntry>,
    options: IngestOptions,
    ctx: IngestContext,
  ): KnowledgeEntry {
    const now = new Date().toISOString();
    const type = partial.type || 'guideline';
    const id = partial.id || this.generateId(type, ctx);

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

  private generateId(type: KnowledgeSubsystem, ctx: IngestContext): string {
    const prefix = type.toUpperCase().slice(0, 3);
    // 序号取自虚拟 index 计数（harness#107 + D7）：不再走 list() 逐条读条目文件；
    // 与 list() 默认过滤口径一致，archived/deprecated 不计入序号。
    // 批内起点 = 批首一次 readIndex，叠加本批已接受条目的终态 maturity——
    // 旧逐条路径里前一条 save 后 auto-fix 的 archived 会立即影响下一条序号，此处同口径复刻。
    const existing = ctx.virtualIndex()
      .filter(e => e.type === type && e.maturity !== 'archived' && e.maturity !== 'deprecated');
    const seq = String(existing.length + 1).padStart(3, '0');
    return `${prefix}-${seq}`;
  }

  private findDuplicate(
    title: string,
    content: string,
    type: KnowledgeSubsystem,
    candidates: KnowledgeEntry[],
  ): KnowledgeEntry | undefined {
    // A1: 共享视图来自盘驱动枚举（readEntriesFromDisk），stale index 不造成去重失效；
    // D7：批内视图含本批已接受终态，重复语义与旧逐条路径一致
    const all = candidates.filter(e => e.type === type);

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

  /**
   * 合并终态（纯，D7 两种写模式共用）：merge 字段口径与来源上限（MAX_SOURCE_REFS）
   * 只此一份。merge 分支不做新条目 auto-fix（既有语义）。
   */
  private computeMerge(
    existing: KnowledgeEntry,
    incoming: KnowledgeEntry,
    options: IngestOptions,
  ): KnowledgeEntry {
    return {
      ...existing,
      content: incoming.content || existing.content,
      maturity: options.maturity || existing.maturity,
      lastReferenced: new Date().toISOString(),
      contributors: [...new Set([...existing.contributors, ...incoming.contributors])],
      projects: [...new Set([...existing.projects, ...incoming.projects])],
      tags: [...new Set([...existing.tags, ...incoming.tags])],
      sourceReferences: [...existing.sourceReferences, ...incoming.sourceReferences].slice(-MAX_SOURCE_REFS),
    };
  }

  private mergeEntries(
    existing: KnowledgeEntry,
    incoming: KnowledgeEntry,
    options: IngestOptions,
  ): KnowledgeEntry {
    const merged = this.computeMerge(existing, incoming, options);
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
