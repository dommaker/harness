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
  StoreUpdate,
} from './types';
import { DEFAULT_DECAY_CONFIG } from './types';
import type { KnowledgeStore } from './store';
import { TEST_ID_PATTERN } from './audit-rules';
import { attempt } from '../utils/attempt';

const MAX_REFERENCED_BY = 20;
const MIN_CONTENT_FOR_PROVEN = 100;
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
          ...(entry.executionResults),
          { contributor: contributor || 'unknown', success, timestamp: now, source: execSource },
        ].slice(-MAX_REFERENCED_BY);
        this.store.update(entryId, { executionResults });
      }
      return entry;
    }

    const referencedBy = [...entry.referencedBy, refKey].slice(-MAX_REFERENCED_BY);
    const executionResults = success !== undefined
      ? [...(entry.executionResults), { contributor: contributor || 'unknown', success, timestamp: now, source: execSource }].slice(-MAX_REFERENCED_BY)
      : entry.executionResults;

    const updated = this.store.update(entryId, {
      lastReferenced: now,
      contributors,
      referencedBy,
      executionResults,
    });

    // Fire consumption event callbacks
    for (const cb of this.onReferenceCallbacks) {
      // 显式 fail-open（attempt）：消费回调是外挂监听，崩了不拖死引用记账主流程
      attempt(() => cb({ entryId, contributor: contributor || 'unknown', timestamp: now, success }), () => undefined);
    }

    return updated;
  }

  /**
   * 批量形 recordReference（P1.3）：一次 query 的 N 条引用收集进一次 applyAll 落盘，
   * 消除 N 次「全量重写 index.json」。逐项语义与逐条 recordReference 一致：
   * same-day refKey 去重（去重时 success 给定额补记 executionResults）、
   * referencedBy 20 条上限、contributors 去重、未知 id 跳过；
   * 回调保持「不早于持久化成功」语义——批量落盘成功后逐条触发，去重/未知 id 不触发
   * （批量本就改变了落盘粒度，不声称逐条版的部分失败时序原样保留）。
   * 单事件调用方仍用 recordReference()（其「返回更新后条目 + 触发回调」契约不变）。
   *
   * D7 引用复用：可选 `preloaded` 传 query 本次已物化的条目（id → 完整条目）——
   * 条目查线不再 store.get，applyAll 以预载为合并基线（层间零重复读取）；
   * 缺省走原取盘路径，原四参公共调用兼容。preloaded 缺项的 id 回退 store.get 取盘，
   * 取不到才按未知 id 跳过。
   */
  recordReferences(
    entryIds: string[],
    contributor?: string,
    success?: boolean,
    source?: 'human' | 'auto',
    preloaded?: ReadonlyMap<string, KnowledgeEntry>,
  ): void {
    const now = new Date().toISOString();
    const updates: StoreUpdate[] = [];
    const events: ConsumptionEvent[] = [];
    const seen = new Set<string>();

    for (const entryId of entryIds) {
      if (seen.has(entryId)) continue;
      seen.add(entryId);
      const entry = preloaded?.get(entryId) ?? this.store.get(entryId);
      if (!entry) continue;

      const contributors = contributor && !entry.contributors.includes(contributor)
        ? [...entry.contributors, contributor]
        : entry.contributors;

      const refKey = `${contributor || 'unknown'}:${now.slice(0, 10)}`;
      const execSource = source || (contributor?.startsWith('auto-') ? 'auto' : undefined);

      // B4: same-day, same-contributor 去重（与逐条版同口径）
      if (entry.referencedBy.includes(refKey)) {
        // 去重仍补记执行结果（若给了 success），但不触发回调
        if (success !== undefined) {
          const executionResults = [
            ...(entry.executionResults),
            { contributor: contributor || 'unknown', success, timestamp: now, source: execSource },
          ].slice(-MAX_REFERENCED_BY);
          updates.push({ id: entryId, partial: { executionResults } });
        }
        continue;
      }

      const referencedBy = [...entry.referencedBy, refKey].slice(-MAX_REFERENCED_BY);
      const executionResults = success !== undefined
        ? [...(entry.executionResults), { contributor: contributor || 'unknown', success, timestamp: now, source: execSource }].slice(-MAX_REFERENCED_BY)
        : entry.executionResults;

      updates.push({ id: entryId, partial: { lastReferenced: now, contributors, referencedBy, executionResults } });
      events.push({ entryId, contributor: contributor || 'unknown', timestamp: now, success });
    }

    // 一次落盘：applyAll 循环内只更新内存索引、结束一次 writeIndex（空批零读写）。
    // 落盘成功前不触发任何回调；抛错则整批中断上抛，由调用方 fail-open 兜底。
    // preloaded 作为合并基线传入：批内条目零重复 get（D7 引用复用）。
    this.store.applyAll(updates, preloaded);

    // 批量落盘成功后才逐条触发消费回调（去重/未知 id 不在 events 内，天然不触发）
    for (const event of events) {
      for (const cb of this.onReferenceCallbacks) {
        // 显式 fail-open（attempt）：消费回调是外挂监听，崩了不拖死引用记账主流程
        attempt(() => cb(event), () => undefined);
      }
    }
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

    const mode = entry.consumptionMode;

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

    const mode = entry.consumptionMode;

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
    const updates: StoreUpdate[] = [];

    for (const entry of entries) {
      const targetMaturity = this.checkEntryDecay(entry.id);
      if (targetMaturity && targetMaturity !== entry.maturity) {
        const change: MaturityChange = {
          entryId: entry.id,
          from: entry.maturity,
          to: targetMaturity,
          reason: `Auto-decay: ${entry.maturity} → ${targetMaturity} (unreferenced for threshold)`,
        };
        updates.push({ id: entry.id, partial: { maturity: targetMaturity } });
        changes.push(change);
      }
    }

    this.store.applyAll(updates);
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

    // AC-8a: After promotion, check skillCandidate eligibility
    // 块 3 子项 6（ADR-0033）：同位触发 constraintCandidate 判定——两标独立，可同挂
    if (target === 'proven') {
      this.checkSkillCandidate(entryId);
      this.checkConstraintCandidate(entryId);
    }

    return change;
  }

  /**
   * AC-8a: Check if a proven entry qualifies as a skillCandidate.
   * Marks with 'skillCandidate' tag and emits event if eligible.
   * Returns true if newly marked.
   */
  checkSkillCandidate(entryId: string): boolean {
    const entry = this.store.get(entryId);
    if (!entry) return false;
    if (!this.isSkillCandidate(entry)) return false;

    // Mark as skillCandidate
    this.store.update(entryId, {
      tags: [...entry.tags, 'skillCandidate'],
    });

    // Emit event for downstream consumers
    const now = new Date().toISOString();
    for (const cb of this.onReferenceCallbacks) {
      // 显式 fail-open（attempt）：外挂监听回调失败不拖死标记主流程
      attempt(() => cb({
        entryId,
        contributor: 'lifecycle',
        timestamp: now,
        context: 'skillCandidate:marked',
      }), () => undefined);
    }

    return true;
  }

  /**
   * AC-8a: Check if an entry meets skillCandidate criteria.
   */
  private isSkillCandidate(entry: KnowledgeEntry): boolean {
    if (entry.maturity !== 'proven') return false;
    if (entry.tags.includes('skillCandidate')) return false;
    if (entry.contributors.length < 3) return false;
    if ((entry.executionResults?.length || 0) < 5) return false;
    if (entry.content.length < 200) return false;

    const execRate = this.getExecutionSuccessRate(entry.id);
    if (!execRate || execRate.rate < 0.7) return false;

    return true;
  }

  /**
   * 块 3 子项 6（ADR-0033）：Check if a proven entry qualifies as a constraintCandidate.
   * Marks with 'constraintCandidate' tag and emits event if eligible.
   * Returns true if newly marked.
   *
   * 判定口径（人类已批准，设计稿 Q4）：proven + 未打过标 + references≥5
   * （referencedBy 条数，与 recordReference 的 refKey 口径一致）+ ≥3 个不同来源会话
   * （contributors，与 skill 候选同字段）。与 skillCandidate 互不干扰，可同挂两标。
   */
  checkConstraintCandidate(entryId: string): boolean {
    const entry = this.store.get(entryId);
    if (!entry) return false;
    if (!this.isConstraintCandidate(entry)) return false;

    // Mark as constraintCandidate
    this.store.update(entryId, {
      tags: [...entry.tags, 'constraintCandidate'],
    });

    // Emit event for downstream consumers
    const now = new Date().toISOString();
    for (const cb of this.onReferenceCallbacks) {
      // 显式 fail-open（attempt）：外挂监听回调失败不拖死标记主流程
      attempt(() => cb({
        entryId,
        contributor: 'lifecycle',
        timestamp: now,
        context: 'constraintCandidate:marked',
      }), () => undefined);
    }

    return true;
  }

  /**
   * 块 3 子项 6：Check if an entry meets constraintCandidate criteria.
   */
  private isConstraintCandidate(entry: KnowledgeEntry): boolean {
    if (entry.maturity !== 'proven') return false;
    if (entry.tags.includes('constraintCandidate')) return false;
    if (entry.referencedBy.length < 5) return false;
    if (entry.contributors.length < 3) return false;

    return true;
  }

  /**
   * AC-8c: Remove skillCandidate tag if success rate drops below 50%.
   * Called after execution writeback.
   */
  checkSkillCandidateRevocation(entryId: string): boolean {
    const entry = this.store.get(entryId);
    if (!entry || !entry.tags.includes('skillCandidate')) return false;

    const execRate = this.getExecutionSuccessRate(entryId);
    if (execRate && execRate.total >= 5 && execRate.rate < 0.5) {
      this.store.update(entryId, {
        tags: entry.tags.filter(t => t !== 'skillCandidate'),
      });
      return true;
    }
    return false;
  }

  /**
   * Get execution success rate for an entry.
   * Returns { rate, total } or undefined if no execution data.
   */
  getExecutionSuccessRate(entryId: string): { rate: number; total: number } | undefined {
    const entry = this.store.get(entryId);
    if (!entry || entry.executionResults.length === 0) return undefined;
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
    if (!entry || entry.executionResults.length === 0) return undefined;
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
        const refCount = entry.referencedBy.length;
        const distinctSources = new Set(entry.sourceReferences.map(s => s.workflow).filter(Boolean));
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
    if (rate && rate.total >= RULE_MIN_RESULTS_FOR_DECAY && rate.rate <= RULE_FAIL_THRESHOLD) return 'deprecated';
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
    const refCount = entry.referencedBy.length;
    if (refCount < SIGNAL_SATURATION_THRESHOLD) return undefined;

    const newer = this.store.list({
      tags: entry.tags,
      excludeArchived: false,
    }).find(e =>
      e.id !== entry.id &&
      e.consumptionMode === 'signal' &&
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
