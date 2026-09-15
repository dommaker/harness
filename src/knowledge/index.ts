/**
 * Knowledge Engine
 *
 * Re-exports all knowledge module components.
 */

export { DEFAULT_DECAY_CONFIG } from './types';
export type {
  KnowledgeSubsystem,
  MaturityLevel,
  StorageLayer,
  ConsumptionMode,
  KnowledgeOrigin,
  KnowledgeEntry,
  SourceRef,
  ExecutionResult,
  KnowledgeReference,
  QueryBudget,
  QueryResult,
  QueryFilter,
  LintIssueType,
  LintIssue,
  IngestOptions,
  MaturityChange,
  DecayConfig,
  DecisionRecord,
  ReferenceRecord,
  IndexEntry,
  SnapshotSurvival,
  ConsumptionStats,
  StoreUpdate,
} from './types';
export type { KnowledgeStore } from './store';
export { FileKnowledgeStore } from './store';
export { KnowledgeQuery } from './query';
export { KnowledgeLifecycle } from './lifecycle';
export type { ConsumptionEvent } from './lifecycle';
export { KnowledgeIngest, sanitizeExternalContent } from './ingest';
export { ReferenceTracker } from './reference-tracker';
export { KnowledgeLinter } from './lint';
export { ColdStartImporter } from './import';
export { KnowledgeHealthScorer } from './doctor';
export { KnowledgeAudit } from './audit';
export type { AuditRuleName, AuditAction, AuditIssue, AuditReport, AuditOptions } from './audit-scoring';
export { migrateKnowledgeEntries } from './migration';
export { extractCodeStructure } from './primitives/code-structure';
export type { CodeStructure, DeclarationInfo, ImportInfo } from './primitives/code-structure';
