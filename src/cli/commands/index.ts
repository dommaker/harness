/**
 * CLI 命令导出
 */

export { check, listLaws, type CheckOptions } from './check';
export { validate, createExampleCheckpoint, type ValidateOptions } from './validate';
export { runPassesGate, checkCoverage, type PassesGateOptions } from './passes-gate';
export { init, type InitOptions } from './init';
export { report, type ReportOptions } from './report';
export { tracesCommand } from './traces';
export { diagnoseCommand } from './diagnose';
export { proposeCommand } from './propose';
export { status, type StatusOptions } from './status';
export { flow, type FlowOptions } from './flow';
export { specValidate, listSpecTypes, type SpecValidateOptions } from './spec';
export { acceptance, listAcceptanceCriteria, type AcceptanceOptions } from './acceptance';
export { performance, type PerformanceOptions } from './performance';
export { security, auditDetails, type SecurityOptions } from './security';
export { contract, validateSchema, type ContractOptions } from './contract';
export { review, reviewStatus, type ReviewOptions } from './review';
