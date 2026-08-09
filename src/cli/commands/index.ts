/**
 * CLI 命令导出
 */

export { check, listLaws, type CheckOptions } from './check';
export { validate, createExampleCheckpoint, DEFAULT_CHECKPOINTS, type ValidateOptions } from './validate';
export { runPassesGate, checkCoverage, type PassesGateOptions } from './passes-gate';
export { init, type InitOptions } from './init';
export { report, type ReportOptions } from './report';
export { status, type StatusOptions } from './status';
export { specValidate, listSpecTypes, type SpecValidateOptions } from './spec';
export { acceptance, listAcceptanceCriteria, type AcceptanceOptions } from './acceptance';
export { performance, type PerformanceOptions } from './performance';
export { security, auditDetails, type SecurityOptions } from './security';
export { contract, validateSchema, type ContractOptions } from './contract';
export { review, reviewStatus, type ReviewOptions } from './review';
export { executeCommand, type CommandCheckOptions } from './command';
export { syncDocs, type SyncDocsOptions } from './sync-docs';
export { knowledgeList, knowledgeSearch, knowledgeImport, knowledgeDecay, knowledgeStats, knowledgeUpsert, knowledgeSyncStatus, knowledgeSyncRag, knowledgeAudit, knowledgeSnapshot, knowledgeMigrate, knowledgeHealth, knowledgeIndex, type KnowledgeOptions, type KnowledgeUpsertOptions } from './knowledge';
export { failureList, failureStats, failureClear, type FailureOptions } from './failure';
export { postevalPlan, type PostEvalPlanOptions } from './posteval-plan';
export { release, type ReleaseOptions } from './release';
export { analyzeSessions, type AnalyzeSessionsOptions } from './analyze-sessions';
export { updateUserModel, type UpdateUserModelOptions } from './update-user-model';
export { constraints, getConstraintsMeta, type ConstraintsMeta } from './constraints';
export { constraintsReport, renderExportMarkdown, type ConstraintsReportOptions } from './constraints-report';
export { constraintsRetire, retireConstraint, runRetireInteractive, printRetireResult, type ConstraintsRetireOptions, type RetireResult, type RetireStatus } from './constraints-retire';
export { docFreshnessCheck, extractClaims, verifyClaims, type DocFreshnessCheckOptions, type ClaimResult, type ClaimType } from './doc-freshness-check';
export { specBaselineCheck, extractBaselineSection, type SpecBaselineCheckOptions, type PrerequisiteResult } from './spec-baseline-check';
export { sddIndex, type SDDOptions } from './sdd';
