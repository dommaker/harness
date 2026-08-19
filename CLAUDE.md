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
npm run hooks:install  # Install this repo's own pre-commit hook (dogfoods current HEAD via node bin/harness.js)
```

## Architecture

### Check/Prompt Dual-Model Constraint System (ADR-0001)

Constraints are defined in `src/core/constraints/definitions/{iron-laws,guidelines,prompts}.ts` (25 total):
- **check · Iron Laws** (5) — severity: error. Real checkers; violation throws `ConstraintViolationError`, blocks execution.
- **check · Guidelines** (4) — severity: warning. Real checkers; records warning, allows continuation.
- **prompt** (16) — pure text injections with role routing and applicability tags; no check slot, no trace stats.

Every check-layer constraint must reference a registered checker (registry closed loop — build fails otherwise). Convention-probing checks (`capability_sync`/`docs_freshness`/`context_doc_sync`) report `skip` when the project hasn't adopted the convention — no blocking, not counted in pass rate.

`getEffectiveConstraints(projectRoot)` (`src/core/effective-constraints.ts`) is the single source of the effective set: built-ins → preset → config.yml disables → custom additions → scenes filtering. init injection, `check`, and external consumers all go through it.

Presets (`src/presets/`) are pure data: `strict` and `standard` enable all constraints; `relaxed` enables only the 5 core check constraints. Filtering lives in `mergeConstraints`; unknown preset names fall back to `standard` with a stderr warning.

### Core Singletons

- `ConstraintChecker` (`src/core/constraints/checker.ts`) — evaluates constraints against a context
- `TraceCollector` (`src/monitoring/traces.ts`) — collects execution traces as append-only JSONL (`.harness/logs/traces.log`)

### Key Subsystems

| Directory | Purpose |
|-----------|---------|
| `src/core/` | Constraint engine, validators (checkpoint, CSO, passes-gate), session management, project config loading |
| `src/gates/` | Quality gates: acceptance, command blacklist, contract (OpenAPI), performance, review, security |
| `src/monitoring/` | Execution Trace collection/analysis, context usage tracking |
| `src/failure/` | Error classification (extensible rules) and failure recording (file-based) |
| `src/context/` | Session management, token budget, compaction, knowledge injection |
| `src/spec/` | (empty) @spec annotation checker removed (ADR-0003); spec story lives in core/spec/validator + SpecAcceptanceGate |
| `src/knowledge/` | Knowledge engine: Store, Query, Lifecycle, Ingest, Linter, Reference Tracker, Cold Start Import |
| `src/sdd/` | SDD index generator: scans `docs/sdd/*/requirement.md`, generates `docs/sdd/_index.md` for grep-based lookup |
| `src/hooks/` | Generic hook pipeline: register, sort, error-isolate, sampled execution |
| `src/agents/` | Agent lifecycle state machine (init → running → paused → completed → failed) |
| `src/tools/` | Tool path management (paths.ts) + 113 yml capability definitions |
| `src/cli/commands/` | 24 CLI subcommands (check, validate, passes-gate, init, report, status, spec, acceptance, performance, security, contract, review, command, sync-docs, knowledge, failure, posteval-plan, release, analyze-sessions, update-user-model, constraints, doc-freshness-check, spec-baseline-check, sdd). Governance subcommands live under `constraints`: `constraints report` (usage stats + retire candidates + config health + injection drift, `--export` sanitized markdown) and `constraints retire` (interactive, human-confirmed retirement; direct `retire <id>` requires explicit `--yes` — without it errors with non-zero exit and no writes → config.yml retired metadata + KnowledgeStore record + CLAUDE.md injection sync, rollback-able) |

### Entry Points

- **Library**: `src/index.ts` — 显式公共导出清单（ADR-0003）：types、子系统公共面与便捷函数（`checkConstraints()`、`checkBeforeExecution()`）
- **CLI**: `bin/harness.js` — commander-based；命令块由 `COMMAND_DEFINITIONS`/`GATE_DEFINITIONS` 注册表驱动生成（无手写命令块），实现按 module+export 引用 per-command 懒加载 `dist/cli/commands/`（O2，--help/--version 零命令实现加载）
- **Package exports**: `.` (full), `./core` (core only), `./presets` (presets only), `./context` (context management), `./gates` (gates only)

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
- New gates must implement the unified `Gate` interface from `src/gates/types.ts` (id/order/evaluate → 三态 `GateDecision`)，报告结构走 `GateResult`；同时必须在 `src/gates/definitions.ts` 补 GateDefinition（含 CLI 元数据）并在 `src/gates/registry.ts` 注册实现——注册表双向闭环，缺一构建期抛错；门禁 CLI 命令由定义表驱动生成（`bin/harness.js`），不再手写命令块
- deny 单调是接口契约：`runGates` 中 deny 不可被下游改回 allow，决策浅冻结；ask 枚举预留、无实现 fail-closed = deny
- Constraint definitions in `src/core/constraints/definitions/` must include `trigger`, `enforcement`, and `description` fields
- Coverage must not decrease — run `npm test -- --coverage` before committing
- Each `src/` subdirectory's entry point is its `CONTEXT.md` (not README). CONTEXT.md documents responsibilities, exports, dependencies, and conventions.
- `CAPABILITIES.md` must be updated when adding or modifying gates or constraints
- All public API exports in `src/index.ts` must have JSDoc comments
- Iron Law violations MUST throw `ConstraintViolationError`, never silently pass
- Trace records must use the `ExecutionTrace` type from `src/types/trace.ts`
- CLI 命令注册的单一来源是 `src/cli/commands/definitions.ts`（COMMAND_DEFINITIONS，含 CLI 元数据与 module+export 实现引用）；bin/harness.js 由定义表驱动生成，禁止手写命令块；definitions 是纯数据模块，禁止 import 任何命令实现/运行时依赖（per-command 懒加载，O2）；新增命令 = 命令实现文件 + 定义表一条 + 测试，实现引用可解析性由 `src/cli/commands/__tests__/registry.test.ts` 断言
- Hook 声明与实现必须注册表闭环：`HookConfig` 声明 ↔ `HookDefinition` 注册一一对应，`assertHookRegistryClosed` 双向校验（引用未注册/注册无定义/重复 → 抛错，断言限构建/测试期）；per-hook 配置归一走 `errorStrategy`（`blocking` → block/warn 无损映射见 `toErrorStrategy`），不再维护平行 blocking 语义

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
