/**
 * Knowledge engine type definitions.
 *
 * Three orthogonal dimensions:
 * - StorageLayer: where knowledge lives (shared boundary)
 * - KnowledgeType: what knowledge describes (MECE)
 * - MaturityLevel: how trusted (lifecycle)
 */

// ── Dimensions ──────────────────────────────────────────────

export type KnowledgeType = 'model' | 'decision' | 'guideline' | 'pitfall' | 'process';

export type MaturityLevel = 'draft' | 'verified' | 'proven' | 'archived';

export type StorageLayer = 'personal' | 'team' | 'tech' | 'domain' | 'project';

// ── Core Entry ──────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  type: KnowledgeType;
  title: string;
  content: string;
  maturity: MaturityLevel;
  layer: StorageLayer;
  created: string;
  lastReferenced: string;
  contributors: string[];
  projects: string[];
  tags: string[];
  applicablePhases: string[];
  sourceReferences: SourceRef[];
  referencedBy: string[];
  decayAt?: string;
}

export interface SourceRef {
  workflow?: string;
  step?: string;
  commit?: string;
  timestamp: string;
}

// ── Query ───────────────────────────────────────────────────

export interface KnowledgeReference {
  id: string;
  title: string;
  usedIn: string;
}

export interface QueryBudget {
  phase: string;
  maxTokens: number;
  maxEntries: number;
  focusTypes: KnowledgeType[];
}

export interface QueryResult {
  entries: KnowledgeEntry[];
  tokensUsed: number;
  truncated: boolean;
  fromCache: boolean;
}

export interface QueryFilter {
  types?: KnowledgeType[];
  maturity?: MaturityLevel[];
  layers?: StorageLayer[];
  tags?: string[];
  applicablePhases?: string[];
  excludeArchived?: boolean;
}

// ── Lint ────────────────────────────────────────────────────

export type LintIssueType = 'orphan' | 'contradiction' | 'outdated' | 'duplicate' | 'index_inconsistent';

export interface LintIssue {
  type: LintIssueType;
  entryId?: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion: string;
}

// ── Ingest ──────────────────────────────────────────────────

export interface IngestOptions {
  source: string;
  layer: StorageLayer;
  maturity?: MaturityLevel;
  tags?: string[];
  projects?: string[];
}

// ── Lifecycle ───────────────────────────────────────────────

export interface MaturityChange {
  entryId: string;
  from: MaturityLevel;
  to: MaturityLevel;
  reason: string;
}

export interface DecayConfig {
  provenDecayMonths: number;
  verifiedDecayMonths: number;
  draftDecayMonths: number;
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  provenDecayMonths: 12,
  verifiedDecayMonths: 6,
  draftDecayMonths: 3,
};

// ── Reference ───────────────────────────────────────────────

export interface ReferenceRecord {
  decisionId: string;
  entryIds: string[];
  timestamp: string;
}

// ── Index ───────────────────────────────────────────────────

export interface IndexEntry {
  id: string;
  type: KnowledgeType;
  title: string;
  maturity: MaturityLevel;
  layer: StorageLayer;
  tags: string[];
  applicablePhases: string[];
  lastReferenced: string;
  created: string;
}
