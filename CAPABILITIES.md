# Harness Capabilities

## CLI Commands (24)
check, validate, passes-gate, init, report, status, spec, acceptance, performance, security, contract, review, command, sync-docs, knowledge, sdd, failure, posteval-plan, update-user-model, release, analyze-sessions, constraints, doc-freshness-check, spec-baseline-check

约束治理子命令挂在 `constraints` 下：`constraints report`（使用统计 + 退役候选诊断 + 配置健康 + 注入漂移，`--export` 脱敏 markdown）、`constraints retire`（交互选择 + 人确认退役；带 id 直达需显式 `--yes`（#24 人确认闸门），无 `--yes` 报错 + 非零退出码且不落盘；内置写 config.yml retired 元数据，custom 写 custom-constraints.yml 条目 retired 段（#82 D6 一处真相）+ KnowledgeStore 沉淀 + CLAUDE.md 注入段同步，可回滚）。

命令注册表（H5）：`COMMAND_DEFINITIONS`（非门禁命令）+ `GATE_DEFINITIONS.cli`（6 门禁命令）是命令形状单一来源，两者形状同为 `CommandDefinition`（ADR-0007），bin/harness.js 单引擎单循环注册表驱动生成（无手写命令块，R6）；实现引用 module+export per-command 懒加载（O2，任一命令执行只加载该命令模块，--help/--version 零命令实现加载）。

## Quality Gates (6)
AcceptanceGate, CommandGate, ContractGate, PerformanceGate, ReviewGate, SecurityGate

统一 Gate 接口（G1，H4）：`Gate{id, order, evaluate(ctx)}` → `GateDecision` 三态 deny | abstain | ask；`GateResult` 保留为报告结构。`gateRegistry` 定义即注册 + 构建期双向闭环（定义无实现/实现无定义/重复 id → 加载期抛错；`getGate` 引用未注册抛错）。`getEffectiveGates(projectRoot)` 声明式裁剪（对齐 getEffectiveConstraints：config.yml `gates.order` 重排 + `gates.<id>.enabled:false` 移除，引用未注册 id 抛错）。`runGates`：deny 单调不可被下游改回 allow（决策浅冻结契约）；ask 枚举预留、无实现 fail-closed = deny。checker-as-guard 接线点 `createCheckerGate(check)`（studio #129 随动）。6 个门禁 CLI 命令由 `GATE_DEFINITIONS` 注册表驱动生成，命令名/别名/选项兼容。

## Constraint Model (kind 二元, ADR-0001)
- check (9)：必须带真实 checker，注册表闭环。Iron Laws (5) 违规阻断；Guidelines (4) 违规告警。
- prompt (16)：纯文本行为约束，带角色路由与适用性标签，不占检查位、不产生 trace 统计。
- skip 语义：约定未采用（capability_sync/docs_freshness/context_doc_sync 存在性探测）或 flag 未接线 → skipped（satisfied=true，不阻断、不计入通率），trace 记 result:'skip'。

## Effective Constraints
getEffectiveConstraints(projectRoot)：全仓唯一生效集来源——内置 → preset 裁剪 → config.yml 禁用（内置与 custom 同效）→ custom 追加（禁用/已退役的不追加）→ scenes 过滤。init 注入、check、外部消费者全部消费它。lintEffectiveConfig 提供 unknownIds/scenes 诊断。

## Injection
renderConstraintsSection（标记区间 HARNESS_CONSTRAINTS_START/END，Output Style 段 HARNESS_OUTPUT_STYLE_START/END，init 幂等修复）；detectInjectionDrift（版本漂移/内容漂移条目级 diff/重复章节；check 警告不阻断，详细 diff 进 report）。

## Constraint Usage Report
buildConstraintsUsageReport：check 层统计表（total/pass/fail/skip、fail 率、首末触发）、四类退役候选诊断（零触发/零拦截/不可评估/高噪）、prompt 注入清单、配置健康；report 与 retire 共用此数据层，只读。

## Monitoring
TraceCollector, TraceAnalyzer, ContextTracker

## Knowledge Infrastructure
KnowledgeStore, KnowledgeLinter, KnowledgeLifecycle (per-mode: rule/reference/context/signal), KnowledgeIngest (incl. external content sanitization), KnowledgeQuery (queryByMode, consume), KnowledgeAudit (6-dimension quality audit), KnowledgeIndexGenerator (single-file grep index, 76-96% output reduction), SDDIndexGenerator (scans docs/sdd/*/requirement.md, generates docs/sdd/_index.md), migrateKnowledgeEntries (AS-021 migration), extractCodeStructure (TS Compiler API code analysis)

## Hook Scripts (bin/)
harness-knowledge-track.sh, harness-sensitive-check.sh

## Agent Infrastructure
AgentLifecycle (init→running→paused→completed→failed)

## Governance
GovernanceExecutor (doc-code-config drift detection, detect-only)

## Doc Freshness
FreshnessRunner (config-driven doc freshness checking: changelog_version, context_docs, doc_dir_check, doc_regex_count), FreshnessAutoFix (regex count auto-fix)

## Hooks
HookRegistry, HookPipeline (register → sort → error-isolate → sampled execution)；`assertHookRegistryClosed` 声明（HookConfig）↔ 实现双向闭环（引用未注册/注册无定义/重复 → 抛错，复制 checker 闭环模式，H5）；`toErrorStrategy` blocking→errorStrategy(block/warn) 无损映射（配置归一，G7）

## Templates
node-api, python-api, nextjs-app
