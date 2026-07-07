/**
 * Knowledge engine type definitions.
 *
 * Three orthogonal dimensions:
 * - StorageLayer: where knowledge lives (shared boundary)
 * - KnowledgeType: what knowledge describes (MECE)
 * - MaturityLevel: how trusted (lifecycle)
 */

// ── Dimensions ──────────────────────────────────────────────

export type KnowledgeSubsystem = 'model' | 'decision' | 'guideline' | 'pitfall' | 'process' | 'architecture';

/** @deprecated Use KnowledgeSubsystem */
export type KnowledgeType = KnowledgeSubsystem;

export type MaturityLevel = 'draft' | 'verified' | 'proven' | 'archived' | 'active' | 'deprecated';

export type StorageLayer = 'personal' | 'team' | 'tech' | 'domain' | 'project' | 'system';

/** How agent consumes this knowledge — drives injection strategy and lifecycle */
export type ConsumptionMode = 'rule' | 'reference' | 'context' | 'signal';

/** Where this knowledge came from — affects initial trust and maturity */
export type KnowledgeOrigin = 'human' | 'agent' | 'external' | 'system';

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
  executionResults: ExecutionResult[];
  decayAt?: string;
  /** How agent consumes this knowledge (default: 'reference') */
  consumptionMode: ConsumptionMode;
  /** Where this knowledge came from (default: 'agent') */
  origin: KnowledgeOrigin;
  /** Path/URL to full content for on-demand retrieval */
  fullContentPath?: string;
  /** Skill ID if this knowledge was refined into a Skill */
  skillId?: string;
}

export interface SourceRef {
  workflow?: string;
  step?: string;
  commit?: string;
  timestamp: string;
}

export interface ExecutionResult {
  contributor: string;
  success: boolean;
  timestamp: string;
  source?: 'human' | 'auto';
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
  consumptionModes?: ConsumptionMode[];
  origins?: KnowledgeOrigin[];
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
  consumptionMode?: ConsumptionMode;
  origin?: KnowledgeOrigin;
  fullContentPath?: string;
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
  /** Sources whose entries skip draft→verified promotion (start at verified) */
  autoPromoteSources: string[];
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  provenDecayMonths: 12,
  verifiedDecayMonths: 6,
  draftDecayMonths: 3,
  autoPromoteSources: [],
};

// ── Decision ────────────────────────────────────────────────

export interface DecisionRecord {
  topic: string;
  category: 'architecture' | 'tooling' | 'process' | 'design';
  context: string;
  decision: string;
  alternatives: string[];
  rationale: string;
  consequences: string;
  participants: string[];
  sourceType: string;
  sourceId?: string;
  revisable: boolean;
  revisitCondition?: string;
}

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
  consumptionMode: ConsumptionMode;
  origin: KnowledgeOrigin;
}
