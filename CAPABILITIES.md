# Harness Capabilities

## CLI Commands (22)
check, validate, passes-gate, init, report, status, flow, spec, acceptance, performance, security, contract, review, command, sync-docs, knowledge, failure, posteval-plan, release, analyze-sessions, update-user-model

## Quality Gates (6)
AcceptanceGate, CommandGate, ContractGate, PerformanceGate, ReviewGate, SecurityGate

## Constraint Layers
- Iron Laws (13): 绝对禁止，无例外
- Guidelines (27): 优先建议，有例外
- Tips (2): 信息性提示

## Monitoring
TraceCollector, TraceAnalyzer, PerformanceMonitor, ConstraintDiagnostics

## Knowledge Infrastructure
KnowledgeStore, KnowledgeLinter, KnowledgeLifecycle (per-mode: rule/reference/context/signal), KnowledgeIngest (incl. external content sanitization), KnowledgeQuery (queryByMode, consume), KnowledgeAudit (6-dimension quality audit), migrateKnowledgeEntries (AS-021 migration)

## Hook Scripts (bin/)
harness-knowledge-track.sh/js, harness-knowledge-check.js, harness-knowledge-capture.js, harness-sensitive-check.sh

## Architecture
ArchitectureEngine, CrossProjectChecker, ConstraintEvolver

## Safety
Sandbox, ToolGuardrail, OutputGuardrail

## Agent Infrastructure
AgentLifecycle (init→running→paused→completed→failed)

## Evolution
autoEvolve (constraint degradation/rollback based on intercept rate)

## Governance
GovernanceExecutor (doc-code-config drift detection, detect-only)

## Doc Freshness
FreshnessRunner (config-driven doc freshness checking: changelog_version, context_docs, doc_dir_check, doc_regex_count), FreshnessAutoFix (regex count auto-fix)

## Dashboard
Stats aggregation, data source management

## LLM Adapter
Unified LLM interface for multi-model switching

## Hooks
HookRegistry, HookPipeline (register → sort → error-isolate → sampled execution)

## Verification
Rules-based verification, loop verification

## Templates
node-api, python-api, nextjs-app
