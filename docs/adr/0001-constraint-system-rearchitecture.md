# ADR-0001: 约束体系重构 —— 删除自动进化，确立 check/prompt 二元模型

- 日期：2026-08-08
- 状态：已接受
- 影响版本：0.17.0（BREAKING）

## 背景

harness 内置三层约束（12 Iron Laws + 28 Guidelines + 2 Tips），README 宣称两层核心价值：运行时约束、知识沉淀（约束按拦截率自动降级并写入 KnowledgeStore）。2026-08-08 架构评审发现：

1. **自动降级链路六环断五环**：trace 写入 `.harness/logs/traces.log` 但所有读取方读 `.harness/traces/execution.log`；拦截率无人计算；`interceptRateThreshold` 从未赋值；`ConstraintEvolver` 永不产出 `change_level` 提案；`degrade()` 只改内存不落盘；`autoEvolve` 无生产调用者。`degrade()` 全链路对 KnowledgeStore **零引用**——README 承诺的"知识沉淀"从未实现。studio 侧 `lastEvolveAt=null`，机制上线以来从未运行一轮。
2. **拦截率信号语义错误**：零拦截分不清"约束过时"与"威慑有效"，不适合自动化。
3. **42 条构成虚胖**：仅 12 条有真实 I/O 检查；15 条依赖调用方传 flag（harness 自身 CLI 路径 4 个 flag 从不设置）；15 条纯文本无检查（10 条 always-pass 恒过桩 + 5 条未注册默认 pass）。
4. **studio trace 实测（29,506 行）**：5 条 flag 型约束 fail 率 100%（flag 从未接线，~4,200 条假拦截）；always-pass/unregistered 约束刷出约六成无意义 pass 记录；`capability_sync` 在未采用 CAPABILITIES.md 约定的 studio 13/13 全 fail。
5. **注入不可裁剪**：`init` 的 CLAUDE.md 注入段绕过 config.yml/preset 直接渲染全集（init.ts:567），使用方禁用约束只影响运行时、文本照注。

## 决策

### 定位

harness = **约束数据 + 执行引擎 + 注入工具 + 知识基建**（类比：agent 行为的 ESLint）。约束进化发生在外环：使用方本地 `retire`（数据不出门）→ 经 `--export`/issue/公开配置到达维护者 → 维护者编辑 definitions → 发版。不使用遥测，不做自动降级。

### 八项架构决策

1. 删除进化子系统：`src/evolution/`、`src/constraints/`（registry + lifecycle-runner）、`src/monitoring/constraint-evolver.ts`、diagnosis-rules 降级规则、`flow` 命令及 `--auto-apply`。保留 `TraceCollector`/`TraceAnalyzer`/`ConstraintDoctor`（归位"观测"）。
2. 新增 `harness constraints retire`：建议层全自动（统计、候选筛选、交互选择器），执行层保留一次人确认；确认后落盘 + 知识沉淀全自动。
3. 删除 `flow` 命令，trace 统计展示并入 `harness constraints report`。
4. `report --export` 输出脱敏 markdown 摘要，供使用方回传给维护者。
5. `retire` 落盘形态 = config.yml `enabled: false` + `retired` 元数据（at/reason/stats），不发明第二套状态。
6. studio-config 的 `harness-ship release` 前置检查插入约束快照步骤（跑 studio 的 `report --export`，快照 git 跟踪，**仅提示不阻断**）。
7. 注入漂移校验：`harness check` 警告（不阻断，版本号漂移单独显眼警告），详细 diff 进 report。
8. 发布协调：harness 0.17.0 一次性 breaking，无 deprecated shim；studio 紧跟删除 `/evolve`、`/constraints/:id/degrade` 端点并升级依赖。

### 数据模型：kind 二元拆分

约束定义拆分为两类，`kind` 判别字段为类型级保证：

- **check**：必须带真实 checker。注册表闭环——引用未注册 checker id 构建报错；删除 always-pass.ts 与"未注册默认 pass"路径。flag 型可留 check 层（含 iron），前提是至少一条真实调用路径在传该 flag；report 提供"flag 从未置真 = 不可评估"诊断。
- **prompt**：纯文本片段，带角色路由与适用性标签，不占检查位、不产生 trace 统计。

### 约束清单：42 → 25（9 check + 16 prompt）

**check · iron（5）**：`no_completion_without_verification`、`incremental_progress`、`no_implementation_without_requirement`（吸收 review 变体）、`no_test_simplification`、`docs_freshness`（存在性探测）

**check · guideline（4）**：`no_hardcoded_credentials`（接入 sensitive-check 成真 checker）、`no_bypass_checkpoint`、`capability_sync`（存在性探测）、`context_doc_sync`（存在性探测）

**prompt（16）**：`no_fuzzy_completion_claim`（吸收 no_self_approval、no_claim_without_evidence、no_excuse_patterns）、`no_fix_without_root_cause`（吸收 no_fallback_without_root_cause、analysis_verification_gate、diagnosis_to_fix_gate）、`simplest_solution_first`（吸收 no_creation_without_reuse_check、yagni_check）、`no_code_without_test`、`no_simplification_without_approval`、`fix_the_problem_not_the_gate`、`verify_external_capability`、`no_delete_without_context`、`design_decision_requires_discussion`、`surgical_changes_only`、`follow_conventions`、`first_principles_first`、`no_conflict_blending`、`no_performative_agreement`、`no_skill_without_test`（场景标签）、`no_model_for_deterministic`（场景标签）

**退役（5）**：`no_any_type`、`test_coverage_required`、`no_coverage_decrease`、`readme_required`、`doc_required_for_public_api`（工具链覆盖：tsconfig/ESLint/Jest 阈值/CI/jsdoc 插件）

**移出内置（2）**：`two_stage_review_required`、`prefer_worktree`（studio 流水线专属，归 studio 自定义约束）

**工具淘汰（1）**：`read_before_write`（Edit 类工具已机械强制先读后写）

### 其他工程决策

- `getEffectiveConstraints(projectRoot)` 为唯一生效集来源：内置 → preset → config.yml 禁用 → custom 追加；init 注入、`check`、消费者导出全部消费它。
- 存在性探测：`capability_sync`/`docs_freshness`/`context_doc_sync` 在约定文件缺失时 skip（不计 pass/fail）。
- `detectTrigger` 补 `code_implementation` 推断（pre-commit 代码文件变更即映射）。
- 适用性标签：语言/框架专属条目标注，init 按项目类型过滤注入。
- init 只写标记区间内：Output Style 段标记化。
- trace 读写路径统一为 `.harness/logs/traces.log`（真实数据所在）。

### 必要性判据（备案）

- check 层三腿：失败模式真实高发；存在可靠机械信号；不被使用方工具链覆盖。
- prompt 层四腿：失败模式真实高发；模型默认行为还不够好；不被同清单另一条覆盖；不被工具链覆盖。

## 后果

- 删除约 6,000 行（含测试）；注入条目从 38 → ~21。
- BREAKING：`autoEvolve`、`ConstraintEvolver`、`ConstraintLifecycleRunner`、`ConstraintRegistry`、`flow` 命令移除。已知唯一消费者 studio 同步跟进（见决策 8）。
- `harness check` 输出可能新增漂移警告（不阻断）。
- 使用方 config.yml 中被移除条目的 `enabled: false` 残留无害（生效集计算忽略未知 id 时应在 report 中提示）。

## 明确不做（防止静默残留）

- 定时快照 cron（趋势数据）：待快照机制跑过几个发版周期后评估。
- LLM 辅助评估"模型是否已内化某条"：可作为 report 增强，待基础链路稳定。
- `no_coverage_decrease` 的 CI 覆盖率比对真 checker：未来工程，需要时单独立项。
- studio 的 E1 进化模块（`apps/api/src/modules/evolution/`）去留：studio 仓内部决策，不阻塞本 ADR。
