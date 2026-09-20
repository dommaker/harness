# ADR-0028: 内置注入规则瘦身——删 11 条冗余/矛盾/不可执行文本规则，check 层 promptInjection 清除

- 日期：2026-09-20
- 状态：已接受
- 影响版本：下一个 minor（维护者决策 2026-09-20：减法变更走 minor，沿用 ADR-0022/0027 口径）
- 关联：harness#174（执行票）；studio#599（triage 出处，2026-09-20 会话决策，治理人闸当场通过）；ADR-0001（kind 二元模型）；ADR-0022（零消费者收缩判据 + minor 同车先例）

## 背景

当前注入 agent 上下文的内置约束 26 条（10 check + 16 prompt）。studio#599 triage 逐条审查后认定其中 13 条属冗余/矛盾/不可执行文本：harness 内置侧删 11 条，studio 自定义侧删 2 条（prefer_worktree、agent_topology_agnostic，不在本仓动手，仅记录）。

## 决策（2026-09-20 会话决策，治理人闸当场通过）

删除 11 条，按删除理由分四类（口径：其中 10 条整删定义，`no_test_simplification` 仅清 promptInjection、定义与 checker 保留；另连带清除 `no_hardcoded_credentials` 的 promptInjection，不计入 11）：

1. **工作流/机制已承载（4）**：`incremental_progress`（拆票机制承载）、`no_implementation_without_requirement`（派单机制承载）、`no_bypass_checkpoint`（checkpoints.yml 机制承载）、`no_performative_agreement`（交互风格，输出风格配置已有同类）。其中前三条为 kind='check'，checker 实现（`iron-flags.ts` 两个 flag checker、`no-bypass-checkpoint.ts`）随定义一并删除——注册表闭环（ADR-0001）不允许孤儿 checker。
2. **已有 checker，文本冗余（1）**：`no_test_simplification` 删 promptInjection 字段，checker 本体不动。
3. **价值观陈述，不可逐条自查（4）**：`simplest_solution_first`、`follow_conventions`、`first_principles_first`、`no_conflict_blending`。
4. **被保留条覆盖（2）**：`no_simplification_without_approval`（⊂ `fix_the_problem_not_the_gate`）、`no_skill_without_test`（⊂ `no_code_without_test`）。

连带清除：`no_hardcoded_credentials` 的 promptInjection（checker 承载执行，注入文本冗余）。`no_completion_without_verification` 例外保留 promptInjection——它是注入段铁律组的唯一条目，保留文本以维持「完成前必须新鲜验证」的铁律在场感。

## 删除后状态

- check 层 7 条（原 10）：iron_law = no_completion_without_verification / no_test_simplification / docs_freshness；guideline = no_hardcoded_credentials / capability_sync / context_doc_sync / governance_presence。
- prompt 层 9 条（原 16）：no_fuzzy_completion_claim / no_fix_without_root_cause / no_code_without_test / fix_the_problem_not_the_gate / verify_external_capability / no_delete_without_context / design_decision_requires_discussion / surgical_changes_only / no_model_for_deterministic。
- 注入段渲染：Iron Laws 组 1 条（no_completion_without_verification），Guidelines 组为空（无 promptInjection 不渲染），Prompts 组 9 条（no_model_for_deterministic 受 llm-app 场景过滤）。
- RELAXED_PRESET 随迁：ironLaws = [no_completion_without_verification]，guidelines = [no_hardcoded_credentials]。
- 场景标签：agent-skill 场景唯一条目随 no_skill_without_test 删除而清空，仅剩 llm-app（no_model_for_deterministic）。
- 证据标志 hasSingleTask / hasRequirement 无内置 checker 消费，字段保留在 ConstraintContext（与 hasReuseCheck 同例，供自定义约束用）。

## 设计方向（记录，本 ADR 不实现）

分类轴从语气三级（iron_law/guideline/prompt）转向执行通道三档（gate/workflow/discipline），注入段最终只渲染 discipline 层。schema 变更待 evolution 晋升机制（studio 侧票）落地时一并做，避免投机性 breaking change。

## 影响

- 生效集 26 → 16 条；`harness check` 不再评估 incremental_progress / no_implementation_without_requirement / no_bypass_checkpoint 三条（其 checker 一并移除）。
- 下游（studio）CLAUDE.md 注入段在下次 `harness init`/注入漂移修复时自动收缩；studio 自定义两条删除由 studio 侧自行处理。
- 迁移路径 = 无需迁移：项目 config.yml 若显式列出已删 id，lintEffectiveConfig 会报 unknownIds，按提示删除即可。
- 测试：已删约束的专属用例随迁；场景过滤测试改用 llm-app/no_model_for_deterministic。
