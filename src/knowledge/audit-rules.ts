/**
 * 知识库质量审计的规则数据表（harness#134 D1–D7 纯模块的规则侧；Phase 3 自 audit-scoring.ts 拆出）
 *
 * 逐条目判定规则的正本：规则定义（detect 谓词 + severity/action/scope + 中文 label）、
 * 规则消费的判定常量、规则上下文类型。零 IO；规则的遍历执行在 `audit-scoring.ts`，
 * 维度分计算在 `audit-dimensions.ts`，落盘与修复动作在 `audit.ts` 的引擎侧。
 */

import { genuineRefs } from './flywheel-metrics';
import type { KnowledgeEntry } from './types';

// ── Types ─────────────────────────────────────────────────

export type AuditRuleName =
  // D1: 结构完整性
  | 'frontmatter-missing'
  // D2: 内容质量
  | 'test-data-pollution'
  | 'daily-audit-noise'
  | 'event-noise'
  | 'zero-content-proven'
  | 'short-content'
  | 'maturity-inflation'
  // D3: 去重有效性
  | 'title-duplicate'
  | 'source-refs-bloat'
  | 'fragment-cluster'
  // D4: 成熟度健康
  | 'promotion-blocked'
  | 'orphan-draft'
  // D5: 新鲜度
  | 'stale-entry'
  // D2: 领域相关性
  | 'deprecated-domain';

export type AuditAction = 'archive' | 'demote' | 'flag' | 'reject' | 'trim';

export interface AuditIssue {
  rule: AuditRuleName;
  entryId: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: AuditAction;
  detail: string;
}

// ── Constants ─────────────────────────────────────────────

export const ZERO_CONTENT_THRESHOLD = 20;
export const MAX_SOURCE_REFS = 20;

const TEST_TAG_PATTERNS = [/^test-scope-/, /^test-empty-/, /^test-\d/];
const DAILY_AUDIT_PATTERN = /^\[Auditor\] Daily audit/;
const EVENT_NOISE_PATTERNS = [
  /^\[Monitor\]\s/,
  /^KnowledgeSync cycle:/,
  /^\[Triage Fix\]\s/,
  /^\[Session Feature\]\s/,
];
const REQUIRED_FRONTMATTER = ['id', 'type', 'title', 'maturity'] as const satisfies readonly (keyof KnowledgeEntry)[];

// ── Per-Entry Rules ───────────────────────────────────────

export interface AuditRule {
  name: AuditRuleName;
  /** 中文展示文案正本（#109）：定义即注册，CLI 经 AUDIT_RULE_LABELS 消费，无 label 即编译期失败 */
  label: string;
  severity: AuditIssue['severity'];
  action: AuditAction;
  /** 规则适用人口：active = 跳过 archived 条目；all = 全人口（含已归档） */
  scope: AuditRuleScope;
  detect: (entry: KnowledgeEntry, ctx: AuditContext) => string | null;
}

export type AuditRuleScope = 'active' | 'all';

export interface AuditContext {
  shortContentThreshold: number;
  staleDays: number;
  promotionBlockDays: number;
  allEntries?: KnowledgeEntry[];
}

export const perEntryRules: AuditRule[] = [
  // D1: 结构完整性
  {
    name: 'frontmatter-missing',
    label: 'frontmatter 缺失',
    severity: 'high',
    action: 'reject',
    scope: 'all',
    detect: (entry) => {
      const missing = REQUIRED_FRONTMATTER.filter(f => {
        // 审计面对的是盘上脏数据：字段在类型上必填、运行时可能缺，取值先压成 unknown 再判空
        const val: unknown = entry[f];
        return val === undefined || val === null || val === '';
      });
      if (missing.length > 0) {
        return `缺少必填字段: ${missing.join(', ')}`;
      }
      return null;
    },
  },

  // D2: 内容质量
  {
    name: 'test-data-pollution',
    label: '测试数据污染',
    severity: 'critical',
    action: 'archive',
    scope: 'active',
    detect: (entry) => {
      // Match test ID patterns
      if (/^(test-|inj-test)/.test(entry.id)) {
        return `测试 ID: "${entry.id}"`;
      }
      const hasTestTag = entry.tags.some(t => TEST_TAG_PATTERNS.some(p => p.test(t)));
      if (hasTestTag) {
        return `测试标签: ${entry.tags.filter(t => TEST_TAG_PATTERNS.some(p => p.test(t))).join(', ')}`;
      }
      // title 不经 parseFile 兜底（缺失正是 D1 的判定对象），运行时可能缺，判空前压空串
      if (/^(Test Entry|Test pattern|Test incident|Empty Test)$/i.test((entry.title || '').trim())) {
        return `测试标题: "${entry.title}"`;
      }
      return null;
    },
  },
  {
    name: 'daily-audit-noise',
    label: '每日审计噪音',
    severity: 'high',
    action: 'archive',
    scope: 'active',
    detect: (entry) => {
      if (DAILY_AUDIT_PATTERN.test(entry.title)) {
        return `每日审计摘要: "${entry.title}"`;
      }
      return null;
    },
  },
  {
    name: 'event-noise',
    label: '运维事件噪音',
    severity: 'critical',
    action: 'archive',
    scope: 'active',
    detect: (entry) => {
      for (const pattern of EVENT_NOISE_PATTERNS) {
        if (pattern.test(entry.title)) {
          return `运维事件标题: "${entry.title}"`;
        }
      }
      return null;
    },
  },
  {
    name: 'zero-content-proven',
    label: '零内容 proven',
    severity: 'critical',
    action: 'demote',
    scope: 'all',
    detect: (entry) => {
      if (entry.maturity === 'proven' && entry.content.trim().length < ZERO_CONTENT_THRESHOLD) {
        return `proven 条目内容仅 ${entry.content.trim().length} 字符`;
      }
      return null;
    },
  },
  {
    name: 'maturity-inflation',
    label: '成熟度虚高',
    severity: 'high',
    action: 'demote',
    scope: 'all',
    detect: (entry) => {
      if (entry.maturity === 'verified' && entry.content.trim().length < ZERO_CONTENT_THRESHOLD) {
        return `verified 条目内容仅 ${entry.content.trim().length} 字符`;
      }
      return null;
    },
  },
  {
    name: 'short-content',
    label: '短内容',
    severity: 'medium',
    action: 'flag',
    scope: 'active',
    detect: (entry, ctx) => {
      const len = entry.content.trim().length;
      if (len < ctx.shortContentThreshold && len >= ZERO_CONTENT_THRESHOLD) {
        return `内容 ${len} 字符 (阈值 ${ctx.shortContentThreshold})`;
      }
      return null;
    },
  },

  // D3: 去重有效性
  {
    name: 'title-duplicate',
    label: '标题重复',
    severity: 'medium',
    action: 'flag',
    scope: 'active',
    detect: (entry, ctx) => {
      if (!ctx.allEntries) return null;
      if (!entry.title) return null;
      const dupes = ctx.allEntries.filter(e =>
        e.id !== entry.id &&
        e.maturity !== 'archived' &&
        e.type === entry.type &&
        e.title?.toLowerCase().trim() === entry.title.toLowerCase().trim()
      );
      if (dupes.length > 0) {
        return `与 ${dupes.map(e => e.id).join(', ')} 标题重复`;
      }
      return null;
    },
  },
  {
    name: 'source-refs-bloat',
    label: 'sourceReferences 膨胀',
    severity: 'low',
    action: 'trim',
    scope: 'all',
    detect: (entry) => {
      const refs = entry.sourceReferences;
      if (refs.length > MAX_SOURCE_REFS) {
        return `sourceReferences ${refs.length} 条 (上限 ${MAX_SOURCE_REFS})`;
      }
      return null;
    },
  },
  {
    name: 'fragment-cluster',
    label: '碎片集群',
    severity: 'medium',
    action: 'flag',
    scope: 'active',
    detect: (entry, ctx) => {
      if (!ctx.allEntries || entry.content.trim().length >= 100) return null;
      if (!entry.tags?.length) return null;

      // Find peers: same type, short body, shared tags ≥2
      const entryTags = new Set(entry.tags);
      const peers = ctx.allEntries.filter(e =>
        e.id !== entry.id &&
        e.maturity !== 'archived' &&
        e.type === entry.type &&
        e.content.trim().length < 100 &&
        e.tags?.filter(t => entryTags.has(t)).length >= 2
      );

      if (peers.length >= 2) {
        return `碎片集群：与 ${peers.map(e => e.id).join(', ')} 同 type+tags 且 body 均 <100 字符，建议合并`;
      }
      return null;
    },
  },

  // D4: 成熟度健康
  {
    name: 'promotion-blocked',
    label: 'promotion 受阻',
    severity: 'medium',
    action: 'flag',
    scope: 'all',
    detect: (entry, ctx) => {
      if (entry.maturity !== 'draft') return null;
      const created = new Date(entry.created);
      const daysSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreated > ctx.promotionBlockDays && !entry.lastReferenced) {
        return `draft 已 ${Math.floor(daysSinceCreated)} 天未被引用`;
      }
      return null;
    },
  },
  {
    name: 'orphan-draft',
    label: '孤儿 draft',
    severity: 'low',
    action: 'flag',
    scope: 'all',
    detect: (entry) => {
      if (entry.maturity !== 'draft') return null;
      if (entry.contributors.length === 0 && entry.projects.length === 0 && genuineRefs(entry.referencedBy).length === 0) {
        return `draft 无贡献者/项目/引用`;
      }
      return null;
    },
  },

  // D5: 新鲜度
  {
    name: 'stale-entry',
    label: '过期条目',
    severity: 'medium',
    action: 'flag',
    scope: 'active',
    detect: (entry, ctx) => {
      const lastRef = entry.lastReferenced || entry.created;
      if (!lastRef) return null;
      const daysSinceRef = (Date.now() - new Date(lastRef).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceRef > ctx.staleDays) {
        return `超过 ${Math.floor(daysSinceRef)} 天未引用 (阈值 ${ctx.staleDays})`;
      }
      return null;
    },
  },

  // D2b: 领域相关性 — 检测已废弃领域的残留条目
  {
    name: 'deprecated-domain',
    label: '废弃领域残留',
    severity: 'high',
    action: 'archive',
    scope: 'active',
    detect: (entry) => {
      const tags = entry.tags.map(t => t.toLowerCase());
      // Tag-level: "pipeline" tag is deprecated (superseded by Agent Network)
      if (tags.includes('pipeline')) {
        return `标签 "pipeline" 属于已废弃领域（已被 Agent Network 取代）`;
      }
      // Title-level: strong domain-specific terms
      const title = entry.title || '';
      if (/pipeline|管线|GoalExecution|DeployAgent|Integration step/i.test(title)) {
        return `标题引用已废弃领域: "${title}"`;
      }
      return null;
    },
  },
];

/** 规则 label 正本表（#109，ADR-0002 定义即注册）：派生自 perEntryRules，与规则键集编译期闭环，CLI 展示层直接消费 */
export const AUDIT_RULE_LABELS: Record<AuditRuleName, string> = Object.fromEntries(
  perEntryRules.map(r => [r.name, r.label])
) as Record<AuditRuleName, string>;
