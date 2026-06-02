# knowledge/

## 职责
知识引擎：知识存储(CRUD)、语义查询、引用追踪、质量审计(Audit)、质量检查(Linter)、生命周期管理、冷启动导入、健康评分。

## 核心导出
- `KnowledgeStore` — 知识条目 CRUD + 结构化存储
- `KnowledgeQuery` — 语义搜索 + 类型/标签过滤
- `KnowledgeLifecycle` — 知识生命周期: draft → candidate → validated → canonical → archived
- `KnowledgeIngest` — 知识摄取引擎（含 ingest gate 质量门）
- `KnowledgeAudit` — 6 维度质量审计引擎（结构/内容/去重/成熟度/新鲜度/飞轮），两种模式：validate(入库检查) + run(全量扫描)，零 token 成本
- `ReferenceTracker` — 知识引用关系图谱
- `KnowledgeLinter` — 知识质量检查(完整性/一致性/时效性)
- `ColdStartImporter` — 冷启动知识导入
- `KnowledgeHealthScorer` — 知识健康评分（doctor.ts）
- `KnowledgeLifecycleHooks` — 生命周期 hook

## 依赖关系
- 依赖 `src/types/` 知识相关类型
- 依赖 `src/monitoring/` KnowledgeDoctor / KnowledgeEvolver
- 被 `src/cli/commands/knowledge.ts` CLI 消费

## 约定
- 知识条目有明确的生命周期状态
- 约束退化时自动写入 KnowledgeStore
- Linter 检查完整性/一致性/时效性三个维度
- Audit 6 维度评分：D1结构 D2内容 D3去重 D4成熟度 D5新鲜度 D6飞轮
- Ingest gate: ingestEntry() 先经 audit.validate() 检查，reject 不入库，archive/demote/flag 后处理

## 注意事项
- Phase 1+4 实现的知识引擎核心
- 约束"退化不删除"——降级时保留规则原文 + 退化原因 + 历史数据
