/**
 * Knowledge Engine
 *
 * Re-exports all knowledge module components.
 */

export * from './types';
export { KnowledgeStore } from './store';
export { KnowledgeQuery } from './query';
export { KnowledgeLifecycle } from './lifecycle';
export type { ConsumptionEvent } from './lifecycle';
export { KnowledgeIngest } from './ingest';
export { ReferenceTracker } from './reference-tracker';
export { KnowledgeLinter } from './lint';
export { ColdStartImporter } from './import';
export { KnowledgeHealthScorer } from './doctor';
export { KnowledgeLifecycleHooks } from './lifecycle-hooks';
export { KnowledgeAudit } from './audit';
export type { AuditRuleName, AuditAction, AuditIssue, AuditReport, AuditOptions } from './audit';
