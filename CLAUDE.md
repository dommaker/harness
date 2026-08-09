# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@dommaker/harness` is a TypeScript framework for enforcing engineering constraints on AI coding agents. It provides a check/prompt dual-model constraint system (ADR-0001), quality gates, trace monitoring, and a CLI. Documentation is primarily in Chinese.

## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode compilation
npm test               # Run Jest tests
npm test -- path/to/test.test.ts  # Run a single test file
npm run lint           # ESLint on src/
```

## Architecture

### Check/Prompt Dual-Model Constraint System (ADR-0001)

Constraints are defined in `src/core/constraints/definitions/{iron-laws,guidelines,prompts}.ts` (25 total):
- **check · Iron Laws** (5) — severity: error. Real checkers; violation throws `ConstraintViolationError`, blocks execution.
- **check · Guidelines** (4) — severity: warning. Real checkers; records warning, allows continuation.
- **prompt** (16) — pure text injections with role routing and applicability tags; no check slot, no trace stats.

`TIPS` is retired (`@deprecated` empty export kept only for in-flight consumer compile compatibility). Every check-layer constraint must reference a registered checker (registry closed loop — build fails otherwise). Convention-probing checks (`capability_sync`/`docs_freshness`/`context_doc_sync`) report `skip` when the project hasn't adopted the convention — no blocking, not counted in pass rate.

`getEffectiveConstraints(projectRoot)` (`src/core/effective-constraints.ts`) is the single source of the effective set: built-ins → preset → config.yml disables → custom additions → scenes filtering. init injection, `check`, and external consumers all go through it.

Presets (`src/presets/`): `strict` and `standard` enable all constraints; `relaxed` enables only the 5 core check constraints.

### Core Singletons

- `ConstraintChecker` (`src/core/constraints/checker.ts`) — evaluates constraints against a context
- `ConstraintInterceptor` (`src/core/constraints/interceptor.ts`) — registers enforcement executors, intercepts operations
- `TraceCollector` (`src/monitoring/traces.ts`) — collects execution traces as append-only JSONL (`.harness/logs/traces.log`)

### Key Subsystems

| Directory | Purpose |
|-----------|---------|
| `src/core/` | Constraint engine, validators (checkpoint, CSO, passes-gate), session management, project config loading |
| `src/gates/` | Quality gates: acceptance, command blacklist, contract (OpenAPI), performance, review, security |
| `src/monitoring/` | Trace collection/analysis, performance monitoring, constraint diagnostics |
| `src/failure/` | Error classification (extensible rules) and failure recording (file-based) |
| `src/context/` | Progressive context loading with worker pool, token budget management |
| `src/architecture/` | Architecture-level constraint checking, cross-project interface contract checking (API sync, type consistency, breaking changes, doc-code consistency) |
| `src/spec/` | Spec annotation validation in code |
| `src/safety/` | Security guardrails: Input/Output/Tool Guardrail + Sandbox (L1-L4) |
| `src/knowledge/` | Knowledge engine: Store, Query, Lifecycle, Ingest, Linter, Reference Tracker, Cold Start Import |
| `src/sdd/` | SDD index generator: scans `docs/sdd/*/requirement.md`, generates `docs/sdd/_index.md` for grep-based lookup |
| `src/hooks/` | Generic hook pipeline: register, sort, error-isolate, sampled execution |
| `src/agents/` | Agent lifecycle state machine (init → running → paused → completed → failed) |
| `src/dashboard/` | Dashboard stats aggregation and data source management |
| `src/llm/` | LLM adapter layer: unified interface for multi-model switching |
| `src/tools/` | Tool registry, core tools, loader, path management |
| `src/verification/` | Rules-based verification engine + loop verification |
| `src/cli/commands/` | 24 CLI subcommands (check, validate, passes-gate, init, report, status, spec, acceptance, performance, security, contract, review, command, sync-docs, knowledge, failure, posteval-plan, release, analyze-sessions, update-user-model, constraints, doc-freshness-check, spec-baseline-check, sdd). Governance subcommands live under `constraints`: `constraints report` (usage stats + retire candidates + config health + injection drift, `--export` sanitized markdown) and `constraints retire` (interactive, human-confirmed retirement → config.yml retired metadata + KnowledgeStore record + CLAUDE.md injection sync, rollback-able) |

### Entry Points

- **Library**: `src/index.ts` — exports all types, modules, and convenience functions (`checkConstraints()`, `checkBeforeExecution()`, `interceptOperation()`)
- **CLI**: `bin/harness.js` — commander-based, imports from `dist/cli/commands/`
- **Package exports**: `.` (full), `./core` (core only), `./presets` (presets only), `./context` (context management)

### Design Principles

- Zero token cost — all analysis is pure file operations, no LLM calls
- No business logic — only provides capabilities; business logic belongs to the caller
- File storage — append-only, single-line JSON, auto-rolling under `.harness/`
- Extensible rules — supports custom constraints and classification rules

## Testing

Tests use Jest with `ts-jest`. Test files live in `__tests__/` directories within each module under `src/`. Pattern: `**/__tests__/**/*.test.ts`. Global coverage threshold: 50% (branches, functions, lines, statements). CI enforces >= 80% line coverage and blocks PRs that decrease coverage by > 1%.

## CI/CD

- **Publish**: Push a `v*` tag to trigger npm publish via GitHub Actions (not local `npm publish`)
- **Coverage**: 85% line coverage enforced by CI (`coverage-gate.yml`)
- **Harness check**: `.github/workflows/harness-check.yml` is a reusable workflow for constraint validation

## Governance Rules

When making changes to this codebase, follow these rules:

### Process

- Every new gate MUST have a corresponding CLI command in `src/cli/commands/` and a test file in `__tests__/`
- Constraint definitions in `src/core/constraints/definitions/` must include `trigger`, `enforcement`, and `description` fields
- Coverage must not decrease — run `npm test -- --coverage` before committing
- Each `src/` subdirectory's entry point is its `CONTEXT.md` (not README). CONTEXT.md documents responsibilities, exports, dependencies, and conventions.
- `CAPABILITIES.md` must be updated when adding or modifying gates or constraints
- All public API exports in `src/index.ts` must have JSDoc comments
- New gates must implement the `GateResult` interface from `src/gates/types.ts`
- Iron Law violations MUST throw `ConstraintViolationError`, never silently pass
- Trace records must use the `ExecutionTrace` type from `src/types/trace.ts`
- CLI commands must be registered in `src/cli/commands/index.ts` and added to `bin/harness.js`

### Behavioral Guidelines

- **Think before coding** — state assumptions explicitly; if multiple interpretations exist, present them before implementing; push back when a simpler approach exists
- **Simplicity first** — minimum code that solves the problem; no speculative features, no abstractions for single-use code, no configurability that wasn't requested
- **Surgical changes** — only touch what the task requires; don't "improve" adjacent code, comments, or formatting; match existing style even if you'd do it differently; remove only orphaned code that your own changes created
- **Goal-driven execution** — define success criteria before implementing; for multi-step tasks, state a brief plan with verification steps; write a failing test first when fixing bugs

## Runtime State

All runtime state lives under `.harness/` (logs, traces, diagnoses, proposals). This directory is created at runtime and should not be committed.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (dommaker/harness), operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage labels used as-is (needs-triage etc.). See `docs/agents/triage-labels.md`.

### Domain docs

single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
