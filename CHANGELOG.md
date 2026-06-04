# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
