# knowledge/

## 职责
知识引擎：知识存储(CRUD)、语义查询、引用追踪、质量审计(Audit)、质量检查(Linter)、生命周期管理、冷启动导入、健康评分、外部内容摄入。

## 三维分类体系 (AS-021)
知识由三个正交维度定义：
- **Topic** — 开放集，用 `tags: string[]` 描述
- **ConsumptionMode** — 闭集 (rule/reference/context/signal)，驱动注入策略和生命周期
- **Origin** — 闭集 (human/agent/external/system)，影响信任度和 maturity 起点

## 生命周期按模式分化
- `rule`: draft → active → deprecated (1 次成功激活, 失败率>=50% 降级)
- `reference`: draft → verified → proven → archived (现有逻辑)
- `context`: draft → active → archived (1 次引用激活, 3 个月未引用归档)
- `signal`: active → archived (消费饱和: ref>=3 + 有更新同标签条目)
- 所有模式支持 `decayAt` 硬过期

## 核心导出
- `KnowledgeStore` — 知识条目 CRUD + 结构化存储
- `KnowledgeQuery` — 语义搜索 + 类型/标签过滤 + `queryByMode()` + `consume(taskContext)`
- `KnowledgeLifecycle` — per-mode 生命周期管理
- `KnowledgeIngest` — 知识摄取引擎（含 ingest gate 质量门）+ `ingestExternal()` 外部内容摄入
- `sanitizeExternalContent` — 外部内容安全清洗（过滤注入模式 + 长度限制）
- `migrateKnowledgeEntries` — AS-021 迁移工具（为现有条目添加 consumptionMode/origin）
- `KnowledgeAudit` — 6 维度质量审计引擎
- `ReferenceTracker` — 知识引用关系图谱
- `KnowledgeLinter` — 知识质量检查(完整性/一致性/时效性)
- `ColdStartImporter` — 冷启动知识导入
- `KnowledgeHealthScorer` — 知识健康评分（doctor.ts）
- `KnowledgeLifecycleHooks` — 生命周期 hook

## 依赖关系
- 依赖 `src/types/` 知识相关类型
- 依赖 `src/monitoring/` KnowledgeDoctor / KnowledgeEvolver
- 被 `src/cli/commands/knowledge.ts` CLI 消费（含 `migrate` 子命令）

## 约定
- 知识条目有明确的生命周期状态（按 consumptionMode 分化）
- 约束退化时自动写入 KnowledgeStore
- Linter 检查完整性/一致性/时效性三个维度
- Audit 6 维度评分：D1结构 D2内容 D3去重 D4成熟度 D5新鲜度 D6飞轮
- Ingest gate: ingestEntry() 先经 audit.validate() 检查，reject 不入库
- 外部内容三层防御：ingest sanitization + retrieval marking + prompt constraint
- 消费饱和度替代固定 TTL 用于 signal 过期判断

## 注意事项
- Phase 1+4 实现的知识引擎核心
- 约束"退化不删除"——降级时保留规则原文 + 退化原因 + 历史数据
- `MaturityLevel` 包含 6 个值: draft/verified/proven/archived/active/deprecated
- `excludeArchived` 同时排除 archived 和 deprecated
