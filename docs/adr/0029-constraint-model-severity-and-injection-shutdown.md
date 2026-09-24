# ADR-0029: 约束模型重构——三层命名废弃、severity 显式化、文本注入层整体关停

- 日期：2026-09-20
- 状态：已接受
- 影响版本：下一个 major（breaking change，无 deprecation 过渡期——消费方仅 studio，双仓同批改）
- 关联：studio#603（裁决出处，2026-09-20 grilling 会话全项确认）；studio#605（harness 侧执行票）；ADR-0001（三层命名与 kind 二元模型被本 ADR 取代；注册表闭环语义保留）；ADR-0028（注入规则瘦身，本 ADR 将其前提推向终态）

## 背景

harness 约束体系原是「Iron Laws / Guidelines / Prompts」三层命名 + kind 二元（check/prompt）：check 层跑 checker，prompt 层纯文本，经 promptInjection 注入消费方的 AGENTS.md/CLAUDE.md（HARNESS_CONSTRAINTS 标记段 + 版本戳 + 漂移校验）。studio#603 裁决认定：文本注入层维护成本高、治理效果可被「机制（checker/gate/CI/hook）+ 消费方手写治理段」完全覆盖，harness 产品面应收编为机制与知识工具。

## 决策（studio#603 裁决全文落地）

1. **三层命名废弃**：Iron Laws / Guidelines / Prompts 从产品面消失。`ConstraintLevel` 删除，`Constraint` 增加显式 `severity: 'error' | 'warning' | 'info'` 字段，check 类约束直接写死（原映射 iron_law→error、guideline→warning）；checker.ts 从 level 派生 severity 的 `getSeverity` 删除。公开 API/CLI 输出/preset 键名里的分层命名改 severity 语义：`ConstraintCheckResult.ironLaws/guidelines` → `errors/warnings`，`ConstraintResult.level` → `severity`，preset 键 `ironLaws/guidelines/prompts` → `errors/warnings`（prompts 键随 prompt 面删除），trace 类型（ExecutionTrace/TraceSummary/TraceAnomaly/TraceFilter）的 `level` → `severity`。约束 id 本身不改。
2. **prompt 面删除**：`kind='prompt'` 变体、`promptInjection`/`injectPrompt`/`appliesTo` 字段删除；`kind` 字段保留、收窄为单值 `'check'`（ADR-0001 注册表闭环语义不变：kind='check' 未注册 checker 直接抛错）。prompt 类 9 条定义（prompts.ts）整体删除，`fix_the_problem_not_the_gate` 随之退役不迁移；`no_completion_without_verification` 的机制本体（checker）保留，注入文本随字段删除消亡，文本由 studio 侧手写治理段承接。
3. **文本注入层关停**：sync-docs/init 的注入段生成逻辑（HARNESS_CONSTRAINTS 标记段 + 版本戳 + 漂移校验）整体摘除——`injection-renderer.ts`、`injection-drift.ts`、`agent-prompt-renderer.ts` 删除；init 的 `setupClaudeMdConstraints`/`setupAgentsMdConstraints`/`setupGovernanceConstraints` 删除（Output Style 段保留，不是约束注入）；check 的注入漂移警告块、constraints report 的漂移小节与 prompt 注入清单删除；retire 的注入段同步删除。`injection-writer.ts` 收窄为通用 marker-range 写入器 + 治理正本探测（PRESERVE 标记保留机制不动，governance_presence 在场守护不动）；历史 HARNESS_CONSTRAINTS 段在 `hasGovernanceContract` 中仅作历史兼容判据保留。
4. **连带退役（施工中判定）**：项目自定义纯文本约束（custom-constraints.yml / `custom_constraints*` 配置 / scenes 场景过滤）的唯一执行语义就是文本注入，注入层关停后无任何消费方，且 kind='check' 注册表闭环不允许无 checker 的约束存在——随文本注入层一并退役。retire 命令收窄为只处理内置 check 约束（落点只剩 config.yml `enabled:false` + retired 元数据 + KnowledgeStore）。

## 取代关系

- ADR-0001 的「三层约束体系」与「kind 二元模型」由本 ADR 取代；其注册表闭环、skip 三态、退役需人确认等机制语义保留，正文不改写历史。
- ADR-0028 的「注入规则瘦身」是过渡态；本 ADR 关停整个文本注入层后，其保留的注入文本（no_completion_without_verification 的 promptInjection）随字段删除消亡。
- ADR-0011 的 injection-writer 收口范围收窄：注入段落点路由（resolveInjectionTarget/resolveGovernanceLanding）删除，marker-range 切片数学与治理探测保留。

## 影响

- 内置约束 16 → 7 条（全部 kind='check'：severity error 3 条、warning 4 条）。
- breaking 面：`Constraint`/`ConstraintResult`/`ConstraintCheckResult`/`MergedConstraintsConfig`/`PresetConfig`/trace 类型/`CustomConstraintDefinition` 形状变更；`IRON_LAWS`/`GUIDELINES`/`PROMPTS` 导出合并为 `CONSTRAINTS`；`renderConstraintsSection`/`renderConstraintsByTrigger`/`CONSTRAINTS_START_MARKER`/`CONSTRAINTS_END_MARKER` 导出删除；init 不再生成 custom-constraints.yml 示例。
- 迁移路径：项目 config.yml 的 `custom_constraints*`/`scenes` 键成为死配置（静默忽略）；`constraints.<id>` 引用已删 id 时 lintEffectiveConfig 报 unknownIds，按提示清理。CLAUDE.md/AGENTS.md 中已注入的 HARNESS_CONSTRAINTS 段不再被 harness 维护，由项目自行处置。
- studio 侧适配（消费 CONSTRAINTS/severity 新面）是另一张票，不在本仓。

## 修订记录

- 2026-09-24（ADR-0035 / harness#180）：注册表闭环措辞收窄为「**gate 通道的规则必须带 checker**」。决策 2 中「kind='check' 未注册 checker 直接抛错」与决策 4 中「kind='check' 注册表闭环不允许无 checker 的约束存在」两处，自 ADR-0035 起以 channel 口径为准：`channel` 非 gate（workflow/discipline）的条目允许无 checker——不进入检查分发、不触发闭环抛错、harness 不渲染不注入（文本注入层关停的裁决不变，discipline 条目只是名册里的数据记录）。正文不改写，以此记录为准。
