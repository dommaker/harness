# Harness Capabilities

## CLI Commands (21)
check, validate, passes-gate, init, report, status, spec, acceptance, performance, security, contract, review, command, sync-docs, knowledge, sdd, failure, posteval-plan, release, constraints, spec-baseline-check

约束治理子命令挂在 `constraints` 下：`constraints report`（使用统计 + 退役候选诊断 + 配置健康，`--export` 脱敏 markdown）、`constraints retire`（交互选择 + 人确认退役；带 id 直达需显式 `--yes`（#24 人确认闸门），无 `--yes` 报错 + 非零退出码且不落盘；写 config.yml retired 元数据 + KnowledgeStore 沉淀，可回滚。ADR-0029：custom 纯文本约束与注入段同步已随文本注入层关停一并退役）。

命令注册表（H5）：`COMMAND_DEFINITIONS`（非门禁命令）+ `GATE_DEFINITIONS.cli`（6 门禁命令）是命令形状单一来源，两者形状同为 `CommandDefinition`（ADR-0007），bin/harness.js 单引擎单循环注册表驱动生成（无手写命令块，R6）；实现引用 module+export per-command 懒加载（O2，任一命令执行只加载该命令模块，--help/--version 零命令实现加载）。

## Quality Gates (6)
AcceptanceGate, CommandGate, ContractGate, PerformanceGate, ReviewGate, SecurityGate

统一 Gate 接口（G1，H4）：`Gate{id, order, evaluate(ctx)}` → `GateDecision` 三态 deny | abstain | ask；`GateResult` 保留为报告结构。`gateRegistry` 定义即注册 + 构建期双向闭环（定义无实现/实现无定义/重复 id → 加载期抛错；`getGate` 引用未注册抛错）。6 个门禁 CLI 命令的判定一律穿过 `evaluate()`，`GateDecision → CommandResult` 的映射与失败措辞收在 `src/cli/gate-command.ts` 一处（架构评审候选1）。`runGates`：deny 单调不可被下游改回 allow（决策浅冻结契约）；ask 枚举预留、无实现 fail-closed = deny；链级暂无调用方，`order` 与本执行器按 #115 的复开条件保留（config.yml 声明式顺序/开关面已收缩，见 ADR-0002「后续变更」）。checker-as-guard 接线点 `createCheckerGate(check)`（studio #129 随动）。6 个门禁 CLI 命令由 `GATE_DEFINITIONS` 注册表驱动生成，命令名/别名/选项兼容。

## Constraint Model (severity 显式, ADR-0029)
- check (7)：全部约束 kind='check'，必须带真实 checker，注册表闭环；severity 写死在定义上——errors (3) 违规阻断；warnings (4) 违规告警。（ADR-0029：三层命名与 kind 二元模型废止，纯文本提示层（prompt 类 9 条 + promptInjection/injectPrompt/appliesTo 字段 + 注入段渲染/漂移校验）整体关停，文本规则由消费方手写治理段承接）
- skip 语义：约定未采用（capability_sync/docs_freshness/context_doc_sync/governance_presence 存在性探测）、context_files 约定已立但无目标（enabled-empty：required_dirs 缺失/空/含非字符串项，工单 84）或 flag 未接线 → skipped（satisfied=true，不阻断、不计入通率），trace 记 result:'skip'。context_doc_sync 与 docs_freshness 对三态判定同构。
- 判定证据语义（harness#119/ADR-0016）：checker 可回 `CheckDetail{pass, evidence}`（旧 `boolean | 'skip'` 形状仍接受），归一点唯一为 `normalizeCheckOutcome`；出口四个——`ConstraintResult.evidence`、`harness check` 的结论块与「💡 提示」块、trace `evidence`、error 级 `ConstraintViolationError.message`（error 级直接 throw，异常文案是其证据唯一外溢面）。分界看因果：**违规**=本次变更造成（进 pass/fail 分母）；**提示**=`pass:true`+evidence（与变更无因果的仓库级漂移，只露出、不拦）。`capability_sync` 的 Step 2 全量完备性属后者（降级后仓库级漏登无自动拦截点——CI/ship 的 `sync-docs --check` 跑在自补行的写入之后，缺口与候选修法见 ADR-0016「影响」）。

## Effective Constraints
getEffectiveConstraints(projectRoot)：全仓唯一生效集来源——内置 → preset 裁剪 → config.yml 禁用。check 与外部消费者全部消费它。lintEffectiveConfig 提供 unknownIds 诊断。

## Constraint Usage Report
buildConstraintsUsageReport：check 约束统计表（total/pass/fail/skip、fail 率、首末触发）、四类退役候选诊断（零触发/零拦截/不可评估/高噪）、配置健康；report 与 retire 共用此数据层，只读。

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

## Release Integrity
verifyReleaseArtifacts / getCriticalArtifacts（#75 N4 收编）：关键发布物清单 = package.json 声明面（main/exports/bin）运行时推导 + 运行时 extras（bin 引导定义表、dist/tools/definitions）随源码维护；pkgRoot 缺省自动解析本包根，外部消费者零参数即自检已安装的 harness。挂载点：release 命令第 4 步、studio publishPackage dist 校验（studio#425 配套切换）

## Runtime Bootstrap
`bootstrapHarness` / `bootstrapHarnessSync` / `HarnessBootstrap`（type）：运行环境组合根，一次调用装配 `ConstraintChecker` + `TraceCollector`（锚 projectPath，harness#88/#139）+ `SessionManager`，并加载 `.harness/config.yml` 产出 `mergedConstraints`。原 `## Hooks` 段的通用管线面（`HookRegistry` / `HookPipeline` / `assertHookRegistryClosed` / `toErrorStrategy` 四值符号 + 八类型）双仓零生产消费者，已随 ADR-0027 整体删除（#170）。

## Templates
node-api, python-api, nextjs-app
