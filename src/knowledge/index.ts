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
  QueryBudget,
  QueryResult,
  QueryFilter,
  IngestOptions,
  MaturityChange,
  DecayConfig,
  IndexEntry,
  SnapshotSurvival,
  ConsumptionStats,
  StoreUpdate,
} from './types';
export type { KnowledgeStore } from './store';
export { FileKnowledgeStore } from './store';
export { KnowledgeQuery, EXTERNAL_SOURCE_MARKER } from './query';
export { estimateTokens } from './token-estimate';
export { KnowledgeLifecycle } from './lifecycle';
export type { ConsumptionEvent } from './lifecycle';
export { KnowledgeIngest } from './ingest';
export type { IngestValidationIssue } from './ingest';
export { ColdStartImporter } from './cold-start';
export { KnowledgeAudit } from './audit';
export type { AuditRuleName, AuditAction, AuditIssue } from './audit-rules';
export type { AuditOptions } from './audit-scoring';
export type { AuditReport } from './audit-dimensions';
