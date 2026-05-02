# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@dommaker/harness` is a TypeScript framework for enforcing engineering constraints on AI coding agents. It provides a three-tier constraint system (Iron Laws / Guidelines / Tips), quality gates, trace monitoring, and a CLI. Documentation is primarily in Chinese.

## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode compilation
npm test               # Run Jest tests
npm test -- path/to/test.test.ts  # Run a single test file
npm run lint           # ESLint on src/
```

## Architecture

### Three-Tier Constraint System

Constraints are defined in `src/core/constraints/definitions.ts` (23 total):
- **Iron Laws** (8) — severity: error. Violation throws `ConstraintViolationError`, blocks execution.
- **Guidelines** (13) — severity: warning. Records warning, allows continuation. Each has exception flags mapped via `EXCEPTION_FIELD_MAP` in `checker.ts`.
- **Tips** (2) — severity: info. Informational only.

Presets (`src/presets/`): `strict` and `standard` enable all constraints; `relaxed` enables only Iron Laws.

### Core Singletons

- `ConstraintChecker` (`src/core/constraints/checker.ts`) — evaluates constraints against a context
- `ConstraintInterceptor` (`src/core/constraints/interceptor.ts`) — registers enforcement executors, intercepts operations
- `ConstraintRegistry` (`src/constraints/registry.ts`) — layered constraint registry with deprecation lifecycle
- `ConstraintLifecycleRunner` (`src/constraints/lifecycle-runner.ts`) — executes evolver proposals against the registry (degrade/rollback/add exception)
- `TraceCollector` (`src/monitoring/traces.ts`) — collects execution traces as append-only JSONL

### Key Subsystems

| Directory | Purpose |
|-----------|---------|
| `src/core/` | Constraint engine, validators (checkpoint, CSO, passes-gate), session management, project config loading |
| `src/gates/` | Quality gates: acceptance, command blacklist, contract (OpenAPI), performance, review, security |
| `src/monitoring/` | Trace collection/analysis, performance monitoring, constraint diagnostics, constraint evolution proposals |
| `src/failure/` | Error classification (extensible rules) and failure recording (file-based) |
| `src/context/` | Progressive context loading with worker pool, token budget management |
| `src/architecture/` | Architecture-level constraint checking, cross-project interface contract checking (API sync, type consistency, breaking changes, doc-code consistency) |
| `src/spec/` | Spec annotation validation in code |
| `src/cli/commands/` | 17 CLI subcommands (check, validate, passes-gate, init, report, status, flow, spec, acceptance, performance, security, contract, review, command, sync-docs, knowledge, failure) |

### Entry Points

- **Library**: `src/index.ts` — exports all types, modules, and convenience functions (`checkConstraints()`, `checkBeforeExecution()`, `interceptOperation()`)
- **CLI**: `bin/harness.js` — commander-based, imports from `dist/cli/commands/`
- **Package exports**: `.` (full), `./core` (core only), `./presets` (presets only)

### Design Principles

- Zero token cost — all analysis is pure file operations, no LLM calls
- No business logic — only provides capabilities; business logic belongs to the caller
- File storage — append-only, single-line JSON, auto-rolling under `.harness/`
- Extensible rules — supports custom constraints and classification rules

## Testing

Tests use Jest with `ts-jest`. Test files live in `__tests__/` directories within each module under `src/`. Pattern: `**/__tests__/**/*.test.ts`. Global coverage threshold: 50% (branches, functions, lines, statements). CI enforces >= 85% line coverage and blocks PRs that decrease coverage by > 1%.

## CI/CD

- **Publish**: Push a `v*` tag to trigger npm publish via GitHub Actions (not local `npm publish`)
- **Coverage gate**: `.github/workflows/coverage-gate.yml` enforces 85% line coverage
- **Harness check**: `.github/workflows/harness-check.yml` is a reusable workflow for constraint validation

## Governance Rules

When making changes to this codebase, follow these rules:

### Process

- Every new gate MUST have a corresponding CLI command in `src/cli/commands/` and a test file in `__tests__/`
- Constraint definitions in `definitions.ts` must include `trigger`, `enforcement`, and `description` fields
- Coverage must not decrease — run `npm test -- --coverage` before committing
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
