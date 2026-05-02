# harness 功能清单

> 最后更新: 2026-05-02
> 铁律：代码变更必须同步更新此文件

---

## 约束引擎

### 核心 (src/core/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 约束定义 | core/constraints/definitions.ts | 23 条内置约束（8 Iron Laws + 13 Guidelines + 2 Tips） |
| 约束检查 | core/constraints/checker.ts | 三层约束检查引擎，支持自定义约束配置 |
| 拦截器 | core/constraints/interceptor.ts | 自动 enforcement 执行，拦截操作并记录 |
| 项目配置 | core/project-config-loader.ts | 项目级约束配置加载 + 合并 |
| 检查点验证 | core/validators/checkpoint.ts | 步骤结果验证 |
| CSO 验证 | core/validators/cso.ts | CSO 验证逻辑 |
| 测试门控 | core/validators/passes-gate.ts | 测试证据验证 |
| Session 管理 | core/session/ | 启动检查点 + 干净状态管理 |
| 启动检查 | core/session/startup.ts | 启动检查点验证 |
| 状态清理 | core/session/clean-state.ts | 结束状态管理 + 自动提交 |
| Spec 验证 | core/spec/ | 代码注解中的 Spec 验证 |
| 默认执行器 | core/constraints/default-executors.ts | architecture-check + cross-project-check 执行器 |

### 约束分层 (src/constraints/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 约束注册表 | constraints/registry.ts | 分层约束注册 + 弃用生命周期（degrade/rollback/scheduleDeprecation） |
| 生命周期执行器 | constraints/lifecycle-runner.ts | 连接 evolver 提案 → registry 操作（ConstraintLifecycleRunner） |
| 类型定义 | constraints/types.ts | LayeredConstraint, DeprecationSchedule 等 |

### 预设 (src/presets/)

| 预设 | 说明 |
|------|------|
| `strict` | 全部约束启用（Iron Laws + Guidelines + Tips） |
| `standard` | Iron Laws + Guidelines（默认） |
| `relaxed` | 仅 Iron Laws |

> 三个预设均定义在 `presets/standard.ts` 中。

---

## 门禁系统 (src/gates/)

| 模块 | 文件 | CLI 命令 | 功能 |
|------|------|:--------:|------|
| 验收标准 | gates/acceptance.ts | `acceptance` / `acc` | 需求验收验证 |
| 性能门控 | gates/performance.ts | `performance` / `perf` | 覆盖率 + 打包大小检查 |
| 安全门控 | gates/security.ts | `security` / `sec` | npm audit 漏洞检查 |
| 契约门控 | gates/contract.ts | `contract` | OpenAPI Schema 验证 |
| 审查门控 | gates/review.ts | `review` | PR 审查状态检查 |
| 命令黑名单 | gates/command.ts | `command` / `cmd` | 危险命令拦截 |

---

## 知识引擎 (src/knowledge/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 知识存储 | knowledge/store.ts | 知识条目 CRUD + 结构化存储 |
| 知识查询 | knowledge/query.ts | 语义搜索 + 类型/标签过滤 |
| 引用追踪 | knowledge/reference-tracker.ts | 知识引用关系图谱 |
| 质量检查 | knowledge/lint.ts | 知识质量检查（完整性/一致性/时效性） |
| 生命周期 | knowledge/lifecycle.ts | 成熟度管理（draft→candidate→validated→canonical→archived） |
| 生命周期钩子 | knowledge/lifecycle-hooks.ts | 状态变更回调 |
| 知识导入 | knowledge/import.ts | 冷启动批量导入 |
| 知识摄取 | knowledge/ingest.ts | 运行时知识摄入 |
| 类型定义 | knowledge/types.ts | KnowledgeEntry, QueryResult 等 |

**生命周期五阶段：**

```
draft → candidate → validated → canonical → archived
  ↑                                           ↓
  └───────── decay check 自动归档 ───────────┘
```

---

## 上下文管理 (src/context/)

| 模块 | 文件 | 功能 |
|------|------|------|
| Token 预算 | context/token-budget.ts | 多级 token 预算分配（system/user/tool/reserve） |
| Token 流水线 | context/token-pipeline.ts | Token 使用追踪和流水线管理 |
| 会话压缩 | context/compaction.ts | 会话压缩策略（摘要/截断/滑动窗口） |
| 会话管理 | context/session-manager.ts | 会话生命周期管理 |
| 渐进式加载 | context/progressive-loader.ts | 渐进式加载 + worker pool 并发 |
| 知识注入 | context/knowledge-injector.ts | 知识条目注入到 Agent 上下文 |
| 文件预算 | context/file-budget.ts | 文件级 token 预算 |
| 工具输出预算 | context/tool-output-budget.ts | 工具输出 token 控制 |

---

## 安全护栏 (src/safety/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 输入护栏 | safety/input-guardrail.ts | 注入检测 + 敏感信息 + 格式校验 |
| 输出护栏 | safety/output-guardrail.ts | 泄露检测 + 有害内容 + 格式合规 |
| 工具护栏 | safety/tool-guardrail.ts | 权限验证 + 参数校验 + 速率限制 |
| 沙箱 | safety/sandbox.ts | 沙箱执行环境管理（L1-L4） |

**沙箱级别：**

| 级别 | 说明 |
|------|------|
| L1 | 只读，无网络 |
| L2 | 只读，受限网络 |
| L3 | 读写，受限网络 |
| L4 | 完全访问 |

---

## 验证循环 (src/verification/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 验证循环 | verification/loop.ts | 验证流程编排 |
| 规则引擎 | verification/rules-based.ts | 基于规则的确定性验证 |
| 类型定义 | verification/types.ts | VerificationResult, Rule 等 |

---

## 监控系统 (src/monitoring/)

| 模块 | 文件 | 功能 |
|------|------|------|
| Trace 收集 | monitoring/traces.ts | 约束检查日志收集（JSON Lines） |
| Trace 分析 | monitoring/trace-analyzer.ts | 统计汇总 + 异常检测 |
| 性能收集 | monitoring/performance-collector.ts | 性能日志收集 |
| 性能分析 | monitoring/performance-analyzer.ts | 性能统计 + 异常检测 |
| 约束医生 | monitoring/constraint-doctor.ts | 约束诊断报告生成 + LLM 深度分析（可选） |
| 约束进化 | monitoring/constraint-evolver.ts | 约束优化提案系统 |
| 知识医生 | monitoring/knowledge-doctor.ts | 知识库健康诊断 |
| 知识进化 | monitoring/knowledge-evolver.ts | 知识库优化提案 |
| 上下文追踪 | monitoring/context-tracker.ts | 上下文使用追踪和分析 |

---

## Agent 管理 (src/agents/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 生命周期 | agents/lifecycle.ts | Agent 状态机（init→running→paused→completed→failed） |
| 类型定义 | agents/types.ts | AgentState, AgentConfig 等 |

---

## LLM 集成 (src/llm/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 适配器 | llm/adapter.ts | 可注入的 LLMAdapter 接口（complete/chat/streamChat/summarize/extract） |
| 类型定义 | llm/types.ts | LLMAdapter, Message, LLMOptions 等 |

---

## 失败处理 (src/failure/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 错误分类 | failure/classifier.ts | ErrorClassifier（可扩展分类规则） |
| 失败记录 | failure/recorder.ts | FailureRecorder（文件存储） |
| 类型定义 | failure/types.ts | ErrorType, FailureLevel, ClassificationRule |

---

## 架构约束 (src/architecture/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 约束引擎 | architecture/constraint-engine.ts | 架构级约束检查（forbidden-pattern / file-count / module-boundary / custom） |
| 跨项目检查 | architecture/cross-project-checker.ts | 跨项目接口契约检查（API 同步/类型一致性/破坏性变更/文档一致性） |

---

## AI 治理 (src/governance/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 治理执行器 | governance/executor.ts | 差异检测（CAPABILITIES.md 同步、CONTEXT.md 状态） |
| 类型定义 | governance/types.ts | GovernanceDiff, DiffType, GovernanceResult |

**治理流程：**
```
detectDiffs() → 输出差异 → LLM 自行修复
```

- harness 只做检测，不做修复
- LLM 通过 `harness sync-docs --check --json` 获取结构化差异，自行编辑文件
- `harness sync-docs` 可自动修复结构化问题（加表格行、创建模板）

---

## Spec 检查 (src/spec/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 注解检查 | spec/annotation-checker.ts | 代码注解中的 Spec 验证 |
| Spec 验证器 | spec/validator.ts | Spec 验证逻辑 |

---

## Dashboard (src/dashboard/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 数据源 | dashboard/data.ts | Dashboard 数据聚合 |
| 统计 | dashboard/stats.ts | 统计计算 |
| 类型定义 | dashboard/types.ts | DashboardData, StatsConfig 等 |

---

## 工具系统 (src/tools/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 工具注册 | tools/registry.ts | 工具注册表 |
| 核心工具 | tools/core/ | 内置工具集 |
| 工具加载 | tools/loader.ts | 工具 YAML 加载 |
| 工具路径 | tools/paths.ts | 工具目录路径解析 |
| 类型定义 | tools/types.ts | ToolDefinition, ToolResult 等 |

---

## CLI (src/cli/commands/)

| 命令 | 文件 | 功能 |
|------|------|------|
| `check` | check.ts | 约束检查 |
| `passes-gate` | passes-gate.ts | 测试门控 |
| `acceptance` | acceptance.ts | 验收标准 |
| `performance` | performance.ts | 性能门控 |
| `security` | security.ts | 安全门控 |
| `contract` | contract.ts | API 契约验证 |
| `review` | review.ts | PR 审查检查 |
| `command` | command.ts | 命令黑名单 |
| `validate` | validate.ts | 检查点验证 |
| `spec` | spec.ts | Spec 验证 |
| `status` | status.ts | 状态查看 + 异常检测 |
| `flow` | flow.ts | 一键诊断 + 提案 |
| `report` | report.ts | 报告生成 |
| `init` | init.ts | 项目初始化（支持 `--governance` 治理级别） |
| `sync-docs` | sync-docs.ts | 文档同步（CAPABILITIES.md + CONTEXT.md 缺失/过时 + CHANGELOG），支持 `--json` 输出 |
| `knowledge` | knowledge.ts | 知识库管理（list/search/import/decay/stats），支持 `--json` 输出 |
| `failure` | failure.ts | 失败记录管理（list/stats/clear），支持 `--json` 输出 |

---

## 类型系统 (src/types/)

| 模块 | 文件 | 说明 |
|------|------|------|
| 约束类型 | types/constraint.ts | Constraint, ConstraintContext, ConstraintResult |
| Iron Law 类型 | types/iron-law.ts | IronLaw, IronLawResult |
| 检查点类型 | types/checkpoint.ts | Checkpoint, CheckpointResult |
| 门禁类型 | types/passes-gate.ts | GateResult, TestEvidence |
| Session 类型 | types/session.ts | StartupCheckpoints, SessionInfo |
| Trace 类型 | types/trace.ts | ExecutionTrace, TraceSummary |
| Performance 类型 | types/performance.ts | PerformanceTrace, PerformanceSummary |
| Enforcement 类型 | types/enforcement.ts | EnforcementId, EnforcementExecutor |
| Spec 类型 | types/spec.ts | SpecDefinition, SpecValidationResult |
| CSO 类型 | types/cso.ts | CSO 相关类型 |
| 项目配置 | types/project-config.ts | 项目级约束配置 + 治理配置（GovernanceConfig） |

---

## 公共工具 (src/utils/)

| 模块 | 文件 | 功能 |
|------|------|------|
| 命令执行 | utils/exec.ts | 统一 execAsync，替代各处重复定义 |

---

## 设计原则

| 原则 | 说明 |
|------|------|
| **零 Token 成本（默认）** | 核心分析不调用 LLM，纯文件操作；LLM 深度分析为可选增强 |
| **无业务逻辑** | 只提供能力，业务逻辑在调用方 |
| **文件存储** | 追加写入，单行 JSON，自动滚动 |
| **可扩展规则** | 支持自定义约束、分类规则 |
| **共同进化** | 模型越强框架越薄，定期删减已被模型内化的能力 |

---

## 存储路径

```
.harness/
├── traces/              # 约束检查记录（JSON Lines）
├── failures/            # 失败记录
├── diagnoses/           # 诊断报告
├── proposals/           # 约束/知识优化提案
├── knowledge/           # 知识库存储
├── state.json           # 运行状态
└── config.yml           # 用户配置
```

---

## 变更日志

| 日期 | 变更内容 |
|------|---------|
| 2026-05-02 | **knowledge/failure CLI**：新增 `harness knowledge`（list/search/import/decay/stats）和 `harness failure`（list/stats/clear）命令 |
| 2026-05-02 | **sync-docs 过时检测**：自动发现 CONTEXT.md 并比较 mtime 检测过时，JSON 输出新增 contextStale |
| 2026-05-02 | **审计修复 #9/#10/#11/#12/#13**：interceptor 吞错 + 覆盖率提升 + JSDoc + CLI 错误处理 + 领域类型 @deprecated 标记 |
| 2026-05-02 | **AI 治理简化**：移除冗余 hook/apply 机制，harness 只检测不修复，LLM 自行处理；sync-docs 新增 --json 输出；18 个 CONTEXT.md |
| 2026-05-02 | **治理系统 Phase 2-3**：sync-docs 命令 + context_doc_sync/docs_freshness 约束（Guideline 13 条，共 23 条） |
| 2026-05-02 | **治理系统 Phase 1**：GovernanceConfig 类型 + init --governance 选项 + CONTEXT.md/CHANGELOG.md/governance CI 生成 |
| 2026-05-02 | **审计修复**：Iron Law #5-#8 闭环 + cross-project-checker stub 实现 + capability_sync 内容检查 + ConstraintLifecycleRunner + 文档同步 |
| 2026-05-02 | **TODO 实现**：checkModuleBoundary 模块边界检查 + agentDiagnose LLM 深度分析 |
| 2026-05-01 | **Phase 1-6 完成**：知识引擎 + 上下文管理 + 安全护栏 + 知识集成 + 约束重构 + 冷启动 |
| 2026-04-29 | **新增命令黑名单门禁**：CommandGate + CLI |
| 2026-04-17 | **新增 Failure Classification**：ErrorClassifier, FailureRecorder |
| 2026-04-17 | **新增 Performance Trace**：PerformanceCollector, PerformanceAnalyzer |
| 2026-04-16 | **新增 Execution Trace**：TraceCollector, TraceAnalyzer |
| 2026-04-10 | **初始版本**：约束系统 + 门禁系统 + 拦截器 |
