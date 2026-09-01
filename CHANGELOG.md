# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.3.0] - 2026-09-01

### Changes
- docs(release): 覆盖口径显式化——深度内部文件不在清单是裁决非遗漏（harness#77）
- feat(release): 发布物完整性自检能力公开导出（harness#77）
- refactor(boundary): 边界净化——词表泛化 + knowledge 缺省数据根 + failures.log 口径（harness#76）

## [1.2.3] - 2026-08-28

### Changes
- fix(test): mkdtemp 泄漏防护——setupFilesAfterEnv 劫持 mkdtempSync 统一清理

## [1.2.2] - 2026-08-26

### Changes
- fix: init 判重升级为能力检测，已有 workflow 覆盖治理命令时跳过创建 harness-governance.yml

## [1.2.1] - 2026-08-24

### Changes
- fix: init 更新 PRESERVE:governance 段只换 HARNESS 标记区间，不再清空段内手写内容
- feat: 注入链读取侧适配 AGENTS.md 落点（studio#307）
- feat: 适配 AGENTS.md 正本文档模型（studio#302）

## [1.2.0] - 2026-08-19

### Changes
- refactor(core): capabilities 统计规则收敛单份定义（ADR-0008，架构评审候选9）——4 项能力清单统计（CLI Commands / Quality Gates / Iron Laws / Guidelines）的 label+pattern+actual 抽为 `CAPABILITY_COUNT_RULES` 单例，check（buildCapabilityChecks）与 write（updateCapabilityCounts）两方向各自投影生成，对外签名与 CAPABILITIES.md 写回结果逐字不变
- refactor(cli,gates)!: 门禁命令定义形状对齐 CommandDefinition，bin/harness.js 单引擎单循环（ADR-0007，架构评审候选8）——删除 `GateCliDefinition`/`GateCliOption` 公开类型，`GateDefinition.cli` 直接为 `CommandDefinition`；`CommandDefinition` 新增 `bareRunsAction` 字段表达门禁裸跑语义。CLI 行为（命令名/别名/选项/子命令/help 输出）逐字不变
- refactor(core)!: 删除 checkConstraintsSafe + getConstraints() 的 .check 装配副作用（ADR-0006，架构评审候选6）——Safe 与 checkConstraints 逐行重复且生产零调用方；getConstraints 变为纯查询，返回类型收窄为 Constraint。`checkConstraints(ctx)` 签名与返回结构（P0 契约）不动
- refactor(core,types,monitoring,cli)!: 删除 guideline 例外机制（ADR-0005，架构评审确认）——`Constraint.exceptions`、config `exceptions`/`extend_exceptions` 键、`ConstraintContext` 24 个例外证据字段 + `exceptionReason`、checker 例外分支、trace `exceptionApplied`/`exceptionCount`/`mostCommonException`/`exception_overuse`/`add_exception` 滥用检测链全链路移除。生产行为无变化（机制从未触发，`checkException` 恒 false）；存量配置中的这两个键静默忽略，不报错不警告
- refactor(core)!: 删除 ConstraintInterceptor 第二执行引擎及 enforcement 类型——生产零调用方，拦截统一由 checkBeforeExecution 承担（ADR-0004，架构评审候选2）
- refactor(core): 生效集筛选逻辑收口一处（架构评审候选3，ADR-0001 闭环）

## [1.1.1] - 2026-08-17

### Changes
- docs: 评审收尾——ADR-0002 版本线 1.0.0 + 文档漂移对齐
- fix(core,cli,monitoring,types): D5/D8 收尾——tip 层级整链摘除 + constraint-doctor 死配置清理
- fix(core): O4 收尾——便捷 API 补 per-request customConfig（checkConstraint/checkBeforeExecution/checkConstraints/interceptOperation）

## [1.1.0] - 2026-08-16

### Changes
- docs(changelog): 清空 [Unreleased] 条目段，待 release 脚本生成 [1.1.0]（避免自动生成后残留重复条目）
- feat(sync-docs): AGENTS.md 知识入口行识别 .studio/CONTEXT.md 正本模型 (studio #188)
- docs(research): 恢复 wayfinder #27/#28 研究正本——harness 现状盘点 + studio→harness 边界盘点（原仅存于游离提交 e3ab6ac/d2874fc，未随 O11 纳入版本控制）
- feat(gates): command-gate PreToolUse hook 固化进包（studio #153）
- feat(completion-checkers): T7-E1 三纯判定函数 tdd-chain/phase-format/contract-presence + CompletionCheckersConfig（#160）
- docs: CLAUDE.md Key Subsystems 清除已删子系统行 + 修正 context/tools 描述（#40 收尾）

## [1.0.0] - 2026-08-16

### Changes
- feat(pkg): H3 exports 治理——./gates 子路径公开 CommandGate（#42）
- feat(core,cli,knowledge): H2 命名与收敛——setCustomConfig 迁移 per-request + KnowledgeType→KnowledgeSubsystem + capabilities 双轨收敛（O4/O5/O10-R3，#41）
- feat!(cleanup): 删除孤儿子系统并收窄 API 面（1.0.0，#40）
- docs(adr,context): ADR-0002 注册型能力「定义即注册+构建期闭环」+ CONTEXT.md 术语落地（#46）
- feat(hooks,cli): H5 hook/命令注册表闭环 + per-command 懒加载（G2/G7/O2/R6，#44）
- feat(gates): H4 门禁统一——Gate 三态 + gateRegistry 构建期闭环 + 声明式 order/enabled + runGates 单调语义 + bin 注册表驱动生成（#43）

## [0.19.0] - 2026-08-15

### Changes
- feat: H6 后半——CheckCache 计数采样 + trigger 参数化分组渲染 API（G5/G6，#45）
- test: 补 analyze-sessions / release 命令测试（O6）
- feat: update-user-model 增加 --days flag（O1）
- chore: package.json 元数据 kww→dommaker（O7）
- docs: 纳入 docs/ 与 AGENTS.md 版本控制（O11）

## [0.18.0] - 2026-08-15

### Changes
- test: init 片段/落盘钩子 plan 匹配模式一致性断言，防模板字面量转义 drift（#35）
- fix: npm run lint 恒失败——补 ESLint flat config 并清零存量违规，CI 接 lint 防再退化（#35）
- fix: 模板/提示裸名 npx harness 全改 scoped @dommaker/harness，自身钩子/CI 改 dogfood node bin/harness.js（#36）
- fix: sync-docs 不再误删 CAPABILITIES.md 中真实存在的 .tsx 模块行（#33）
- feat: SourceRef 增加 entryId 条目级回指字段（#23）
- fix: 内置 no_completion_without_verification 验证命令口径弱化（#25）
- fix: constraints retire 直达路径补 --yes 人确认闸门（#24）
- feat: custom 约束退役落点迁至 custom-constraints.yml（#82 D6 一处真相）
- fix: mergeConstraints 生效 config.yml 对 custom 约束的禁用

## [0.17.1] - 2026-08-09

### Changes
- fix(constraints): 自定义约束 promptInjection 未透传，收编约束进不了注入段

## [0.17.0] - 2026-08-08

约束体系重构（ADR-0001）：删除自动进化子系统，确立 check/prompt 二元模型。决策依据见 `docs/adr/0001-constraint-system-rearchitecture.md`。

### BREAKING
- **删除进化子系统**：`src/evolution/`（`autoEvolve`）、`src/constraints/`（`ConstraintRegistry` + `ConstraintLifecycleRunner`）、`src/monitoring/constraint-evolver.ts`（`ConstraintEvolver`）、diagnosis-rules 降级规则全部移除
- **删除 `flow` 命令**及 `--auto-apply`；trace 统计展示并入 `harness constraints report`
- **约束清单 42 → 25**（9 check + 16 prompt），定义文件改为 `definitions/{iron-laws,guidelines,prompts}.ts`；`tips.ts` 删除
- **`TIPS` 导出变化**：恒为空表并标记 `@deprecated`（仅为在途消费者编译兼容保留，后续删除）
- 退役 5 条（工具链已覆盖）：`no_any_type`、`test_coverage_required`、`no_coverage_decrease`、`readme_required`、`doc_required_for_public_api`
- 移出内置 2 条（studio 流水线专属，归 studio 自定义约束）：`two_stage_review_required`、`prefer_worktree`
- 工具淘汰 1 条：`read_before_write`（Edit 类工具已机械强制先读后写）
- 其余合并：`no_implementation_without_requirement`（吸收 review 变体）、`no_fuzzy_completion_claim`（吸收 no_self_approval/no_claim_without_evidence/no_excuse_patterns）、`no_fix_without_root_cause`（吸收 no_fallback_without_root_cause/analysis_verification_gate/diagnosis_to_fix_gate）、`simplest_solution_first`（吸收 no_creation_without_reuse_check/yagni_check）
- 使用方 config.yml 中被移除条目的 `enabled: false` 残留无害（生效集计算忽略未知 id，`constraints report` 会提示）

### Added
- **`harness constraints report`**：check 层使用统计（total/pass/fail/skip、fail 率、首末触发）+ 四类退役候选诊断（零触发/零拦截/不可评估/高噪）+ 配置健康（unknownIds 残留）+ 注入漂移小节；`--export [file]` 输出脱敏 markdown 摘要供回传维护者
- **`harness constraints retire [id] [--reason]`**：交互选择器 + 一次人确认；落盘 config.yml `enabled: false` + `retired` 元数据（at/reason/stats）；KnowledgeStore 写决策记录（规则原文+原因+历史统计）；自动同步 CLAUDE.md 注入段；删除 config.yml 对应段即可回滚
- **`getEffectiveConstraints(projectRoot)` 公共 API**：全仓唯一生效集来源——内置 → preset 裁剪 → config.yml 禁用 → custom 追加 → scenes 过滤；init 注入/check/消费方全部走它（`src/core/effective-constraints.ts`，附 `lintEffectiveConfig` 诊断）
- **skip 语义**：约定未采用（`capability_sync`/`docs_freshness`/`context_doc_sync` 存在性探测）或 flag 未接线 → skipped（satisfied=true，不阻断、不计入通率），trace 记 `result:'skip'`；`detectTrigger` 补 `code_implementation` 推断（代码文件变更），新增 `extraTriggers`
- **注入漂移校验**：`check` 警告不阻断（版本漂移 ⚠️ 单独显眼提示），`report` 给条目级 diff（`injection-drift.ts`）
- **config.yml 新增 `scenes: string[]`**：场景专属 prompt（`no_skill_without_test`、`no_model_for_deterministic`）仅在 scenes 命中时进入生效集
- **`no_hardcoded_credentials` 真 checker**：凭证模式扫描 staged diff（接入 sensitive-check）
- init：注入段只渲染生效集；Output Style 段标记化（HARNESS_OUTPUT_STYLE_START/END）；幂等修复

### Changed（行为变化，发版须知）
- config.yml 的 `preset` 字段现在**真正影响运行时检查**；`relaxed` = 仅 5 条 check（3 iron + 2 guideline），prompt 全禁用
- init 注入尊重配置：禁用/裁剪后的约束不再出现在 CLAUDE.md 注入段（注入条目 ~38 → ~21）
- trace 读写路径统一为 `.harness/logs/traces.log`（`DEFAULT_TRACE_FILE`，`src/types/trace.ts`）
- `harness check` 输出可能新增注入漂移警告（不阻断）

### Fixed
- `capability_sync` checker 三处校验缺陷：step1 改为要求每个变更文件都被覆盖（every 而非 some，杜绝漏网）；修复 endsWith 后缀碰撞（xfoo.ts 误被 foo.ts 覆盖）与 includes 子串误配（docs/src/foo.tsx 误被 src/foo.ts 覆盖）（含回归测试）

## [0.16.9] - 2026-08-08

### Changes
- feat(capabilities): CAPABILITIES.md 支持策划制模块级清单——新增 `governance.capabilities.mode`（file/module/listing，缺省 file 行为不变）；module 模式下 capability_sync 第二步改为「文件条目精确匹配 OR 目录条目前缀」覆盖判定、sync-docs 不再自动加文件行（幽灵剔除保留）、--check 按目录聚合报告未登记模块
- feat(sync-docs): 新增 `--compact` 迁移命令，同目录 ≥2 个文件行折叠为一行目录条目（幂等、PRESERVE 块保留）
- test(checker): 补 capability_sync 第二步全量扫描专项用例（T-058 核心逻辑此前无测试覆盖）

## [0.16.8] - 2026-08-08

### Changes
- fix(sync-docs): CAPABILITIES 幽灵条目全路径清扫 + docs_freshness 报出缺失文件名
- docs(readme): 深度重构后 README 刷新 (#16)
- docs(changelog): 补 0.16.7 条目——修复 changelog_version 版本漂移门控

## [0.16.7] - 2026-08-07

### Changes
- **深度重构**：constraints definitions 拆分为 iron-laws/guidelines/tips 三层；checker 规则拆至 checkers/ 目录；checkpoint 校验拆至 validators/check-handlers/；sync-docs 拆为 sync-docs/ 模块族；会话挖掘收拢至 cli/session-mining/
- **死代码清理**：删除 governance executor、prompt-injection 别名、knowledge 孤儿脚本等（-12000+ 行）
- fix(checkpoint): output_* 检查行为修复；validate 门控失败时返回退出码 1
- refactor(monitoring): constraint-doctor 诊断规则数据化（diagnosis-rules）

## [0.16.6] - 2026-07-29

### Changes
- fix(sync-docs): AGENTS.md 知识入口不再写入易变的条目数

## [0.16.5] - 2026-07-27

### Fixed
- **init 不再覆盖已有运行时配置**：重跑 `harness init` 时，`.harness/checkpoints.yml` 与 `.harness/resolutions.json` 已存在则跳过（打印灰色提示），不再被静默重置为内置默认——与 custom-constraints.yml 的既有存在检查行为对齐。两个文件均不入 git，此前被覆盖无版本兜底

## [0.16.4] - 2026-07-24

### Added
- **sync-docs --agents PRESERVE 标记段**：AGENTS.md 中 `<!-- PRESERVE:名称 -->` 与 `<!-- /PRESERVE:名称 -->` 之间的内容由使用者保留——重新生成时原样穿过（附于生成内容之后，保持相对顺序），漂移比对基于"生成部分 + 保留块"的组合结果，块内手改不报漂移，`--check` 对组合文件可用。未闭合的标记块不予保留并告警。

## [0.16.3] - 2026-07-22

### Changes
- fix(sync-docs): 删除 stale 条目正则修复 — basename 匹配完整路径列
- test(sync-docs): 补 --agents 覆盖率低分分支（statements 78.9% → ≥79.5%）
- docs: CHANGELOG 补齐 0.16.1/0.16.2（修复 docs_freshness 铁律 changelog_version 检查）

## [0.16.2] - 2026-07-20

### Added
- **sync-docs --agents**: AGENTS.md 生成器——面向 agent 的仓库导读（结构/命令/约束/知识入口），挂在 `sync-docs` 命令下

### Fixed
- CLAUDE.md 分层计数修正（13/27 → 12/28）
- src/cli/commands/CONTEXT.md 命令计数修正（21 → 25，补 sdd/constraints/doc-freshness-check/spec-baseline-check）
- CHANGELOG 补齐 0.16.1/0.16.2（修复 docs_freshness 铁律 changelog_version 检查）

## [0.16.1] - 2026-07-17

### Added
- knowledge 模块导出纳入发布产物
- CAPABILITIES 增加 sdd CLI 命令

### Changed
- release 命令支持受保护 master 分支时改走 PR 流程

## [0.16.0] - 2026-06-10

### Changed
- **prefer_worktree demoted to guideline**: `prefer_worktree` moved from iron_law to guideline severity — worktree usage is now recommended, not enforced
- **KnowledgeStore interface extracted**: `FileKnowledgeStore` implements `KnowledgeStore` interface, enabling mock/testing and future alternative implementations

## [0.15.0] - 2026-06-07

### Changed
- Internal release (constraint tier adjustment prep)

## [0.14.0] - 2026-06-04

### Added
- **ConsumptionMode + KnowledgeOrigin types** (AS-021 P1): `rule | context | signal | reference` 消费模式，`system | agent | human | external` 知识来源
- **Per-mode lifecycle** (AS-021 P2): rule/context/signal 三条独立生命周期路径
- **queryByMode + consume()** (AS-021 P3): 按 consumptionMode 查询 + 消费时 recordReference
- **External content sanitization** (AS-021 P4): `ingestExternal()` 剥离 prompt injection 模式 + 长度限制
- **Migration script + CLI** (AS-021 P5): `harness knowledge migrate` 旧条目自动标记 consumptionMode
- **6-dimension quality audit engine**: `harness knowledge audit [--fix] [--dry-run]`，健康分 + 自动修复
- **KR4 snapshot mechanism**: 每日 index.json 快照 + 30 天存活率统计
- **GAP-11 promotion content quality gate**: draft→verified 要求 content ≥ 50 字符
- **Semantic dedup + test ID interception**: KnowledgeIngest 去重增强
- **Execution success rate tracking**: Path C 自动晋升依据
- **Human/auto contributor classification**: 晋升来源区分
- **D6 flywheel stats**: `harness knowledge stats` 展示飞轮指标
- **hooks → Agent Event Protocol API** (B9-016): 通用 hook 管线暴露为 API

### Fixed
- **飞轮质量审计 5 项根因修复**: 噪音治理 + 资源优化
- **B12 噪音治理**: 低质量条目过滤 + 资源优化
- **E3 findFile 碰撞修复**: 文件查找哈希碰撞
- **`no_delete_without_context` 增强**: 零引用 ≠ 无价值
- **undefined tags/applicablePhases guard**: matchesFilter 空值保护

## [0.13.0] - 2026-05-26

### Breaking
- **prompt-injection 迁移**: `formatConstraintsForPrompt()` + `AgentRole` + `ROLE_TRIGGERS` 迁至 `@dommaker/studio-shared`。harness 保留 deprecated re-export。
- **`buildConstraintPrompt()` 移除**: 孤儿函数从未消费，且截断 80 字符。已删除。
- **死亡代码清理**: `changelog_freshness` 孤儿约束、`changelog_missing` DiffType、`sync-docs --changelog`、`auto_append` config。

### Added
- **`detectSourceRoots()`**: 统一源码目录发现。支持 monorepo (packages/*, apps/*) 和单 repo (src/, lib/)。替代 5 种分散硬编码。
- **`harness constraints --json`**: 约束元数据导出（version, hash, counts, textSize）。
- **`harness init` → CLAUDE.md**: 写入标记段（HARNESS_CONSTRAINTS），含约束列表和版本号。
- **`module_creation` 触发**: `detectTrigger()` 识别新目录文件变更。
- **11 条约束补 `promptInjection`**: `no_code_without_test` 等从不可见变为 CLAUDE.md + Agent prompt 可见。

### Changed
- **内置 Freshness 泛化**: 10 项 harness 特化 → 2 项通用（CONTEXT.md + CHANGELOG 版本）。
- **`findSourceFiles` 跳过 `index.ts`**: 与 `scanSourceModules` 一致。
- **管线运行时去重**: CLAUDE.md 已有约束段时注入引用而非全量文本。
- **预设 `required_dirs` 自动发现**: 不硬编码 `['src']`。

### Fixed
- `@jest/globals` 缺失 → 安装后 119/119 测试通过。
- monorepo 工程 `harness init` 后全部检测盲过。
- `index.ts` 导致 `docs_freshness` 误报。

## [0.12.2] - 2026-05-19

### Added
- **fix_the_problem_not_the_gate guideline**: 质量门阻断时修复代码，不修复门禁

## [0.12.1] - 2026-05-19

### Added
- **first_principles_first guideline**：第一性优先分析方法论。injectPrompt=true。
- **5 behavioral guidelines**：surgical_changes_only / no_model_for_deterministic / no_conflict_blending / read_before_write / follow_conventions。全部 injectPrompt=true。
- **2 增强 promptInjection**：no_performative_agreement / simplest_solution_first 补充 prompt 注入文本。
- **interceptor 收敛**：无 executor 时 fallback 到 constraint.check(ctx)。

### Changed
- **docs_freshness 升级为 iron_law**：guideline → iron_law (blocking)。
- **CONTEXT.md 删除**：17 个文件。目录描述集中在 CLAUDE.md Key Subsystems 表。
- 约束总数：13 Iron Laws + 13 Guidelines + 2 Tips = 28 条。
- promptInjection 优化：357→80 tokens (75% 缩减)。
- **约束生命周期修正**：退化基于拦截率（≥10 次检查 + 拦截率 < 30%），不基于日历时间。

## [0.11.0] - 2026-05-03

### Added
- **6 条新约束**：must_use_worktree / no_fuzzy_completion_claim / no_performative_agreement / two_stage_review_required（Iron Law）+ no_excuse_patterns / yagni_check（Guideline）
- **meeting_decision_check trigger**：会议决策质量检查
- **buildConstraintPrompt()**：收集约束 promptInjection 格式化为 Agent system prompt 片段
- **knowledge/failure CLI**：harness knowledge / harness failure 命令
- **sync-docs 命令**：文档新鲜度检查 + JSON 输出

### Changed
- 约束总数：8 Iron Laws → 12，13 Guidelines → 15，共 29 条
- AI 治理简化：移除冗余 hook/apply，harness 只检测不修复
- interceptor 修复 + 覆盖率 85.4% + JSDoc
- `autoEvolve()` 纯计算 API + `evolution/auto-evolve.ts` 新模块
- `checkConstraints()` 新增 `onTrace` 回调参数

## [0.9.0] - 2026-05-01

### Added

#### Phase 1: 知识引擎核心
- KnowledgeStore: 知识条目 CRUD + 结构化存储
- KnowledgeQuery: 语义搜索 + 类型/标签过滤
- ReferenceTracker: 知识引用关系图谱
- KnowledgeLinter: 知识质量检查 (完整性/一致性/时效性)

#### Phase 2: 上下文管理
- TokenBudget: 多级 token 预算分配 (system/user/tool/reserve)
- SessionCompaction: 会话压缩策略 (摘要/截断/滑动窗口)
- AgentLifecycle: Agent 状态机 (init→running→paused→completed→failed)

#### Phase 3: 安全护栏
- InputGuardrail: 输入内容安全检查 (注入检测/敏感信息/格式校验)
- OutputGuardrail: 输出内容安全检查 (泄露检测/有害内容/格式合规)
- ToolGuardrail: 工具调用安全检查 (权限验证/参数校验/速率限制)
- Sandbox: 沙箱执行环境管理 (级别 L1-L4/资源限制/隔离策略)

#### Phase 4: 知识引擎集成
- KnowledgeService: 统一入口 (Store + Query + Tracker + Linter)
- 知识生命周期: draft → candidate → validated → canonical → archived
- 跨项目知识迁移: 模式识别 + 最佳实践提炼

#### Phase 5: 约束重构
- ConstraintContext 扩展: 新增 isExternalDependency/isExplicitInstruction/isEmergencyFix/isExistingDesign
- 自定义约束配置: .harness/config.yml 支持 extend_exceptions
- 约束进化提案: 基于 trace 分析自动生成优化建议

#### Phase 6: 冷启动
- progressive-loader.ts: 渐进式加载 + worker pool 并发
- cross-project-checker.ts: 跨项目依赖检查 (异步化)
- project-config-loader.ts: 项目配置加载 + 约束合并

### Changed
- SafetyService/ContextService/AgentService 单例导出
- KnowledgeService 单例导出
- CLI 新增 harness flow --auto-apply 自动应用低风险提案

## [0.8.4] - 2026-05-01

### Changed

#### 重复代码消除
- 统一 `execAsync` 到 `utils/exec`：15 个文件的重复定义合并为单一来源
- 新增 `normalizeTriggers()` 泛型工具函数，消除 10+ 处 `Array.isArray` 重复模式
- 新增 `delay()` 公共函数，替换 3 处私有 `sleep/delay` 方法

#### 逻辑简化
- `checker.ts`：60 行 `switch` 例外匹配 → `EXCEPTION_FIELD_MAP` 映射表 + `some()` 一行
- `checker.ts`：3 个近似循环 → 提取 `matchesTrigger()` + `recordTrace()` 公共方法
- `interceptor.ts`：触发器规范化 → 复用 `normalizeTriggers`
- `trace-analyzer.ts` / `performance-analyzer.ts`：5 次/3 次遍历统计 → 单次遍历
- `failure/recorder.ts`：`getByType`/`getByLevel` 重复过滤 → 提取 `getFiltered()`

#### 健壮性修复
- 修复 `checker.ts` 中 Guidelines 循环直接引用 `GUIDELINES` 常量的 bug（未使用自定义约束配置）
- 修复 `project-config-loader.ts` 中 `mergeConstraints()` 的 for 循环缩进错误（方法体脱离类作用域）
- 修复 `progressive-loader.ts` 中 `delay` 参数名与导入函数冲突
- 补充 `ConstraintContext` 缺失字段：`isExternalDependency`、`isExplicitInstruction`、`isEmergencyFix`、`isExistingDesign`

#### 性能优化
- `cross-project-checker.ts`：`execSync`（阻塞式）→ 异步 `runCommand`
- `progressive-loader.ts` `processBatch`：并发结果顺序不保证 → worker pool 模式保证输入顺序

#### 代码规范
- `cli/commands/status.ts`：`any` 类型 → `TraceSummary` / `TraceAnomaly`
- `cross-project-checker.test.ts`：更新 mock 从 `child_process` → `utils/exec`
- 合并 10+ 处分散的 `import { exec } + promisify(exec)` 为统一导入

> 净减少约 157 行代码，零编译错误，零测试回归

---

## Recent Commits

- feat: add command CLI for blacklist checking (2026-04-29 23:24:07 +0800)
- feat: add CommandGate for command blacklist (SEC-006) (2026-04-29 23:09:44 +0800)
- fix: remove deprecated command tests (propose, diagnose, traces) (2026-04-29 01:10:46 +0800)
- chore: release v0.8.0 (2026-04-28 23:41:32 +0800)
- docs: decouple Trace section from business logic (2026-04-28 23:39:12 +0800)
- chore: remove docs and specs directories (moved to .gitignore) (2026-04-28 23:37:35 +0800)
- chore: ignore docs directory (2026-04-28 23:36:39 +0800)
- docs: remove deprecated note from README (2026-04-28 23:34:30 +0800)
- refactor(cli): remove deprecated commands (traces, diagnose, propose) (2026-04-28 23:32:26 +0800)
- docs: sync CLI commands to README (2026-04-28 23:23:47 +0800)
- feat(cli): add 5 gate commands - acceptance, performance, security, contract, review (2026-04-28 23:04:33 +0800)
- chore: ignore specs directory in gitignore (2026-04-28 22:56:59 +0800)
- chore: ignore specs/templates 目录 (2026-04-28 22:52:51 +0800)
- feat: 新增覆盖率约束机制 (2026-04-28 22:50:15 +0800)
- test: 覆盖率达标 85.43%！ (2026-04-28 22:39:48 +0800)
- test: 覆盖率提升至 84.8% (2026-04-28 22:34:31 +0800)
- test: 覆盖率提升至 83.93% (2026-04-28 22:29:51 +0800)
- chore: 清理临时测试文件 (2026-04-28 22:21:01 +0800)
- test: 覆盖率提升至 84.17% (2026-04-28 22:20:54 +0800)
- init (2026-04-28 22:11:12 +0800)

---

> 自动生成于 2026-04-30
