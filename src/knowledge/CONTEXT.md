# knowledge/

## 职责
知识引擎：知识存储(CRUD)、语义查询、引用追踪、质量检查(Linter)、生命周期管理、冷启动导入、健康评分。

## 核心导出
- `KnowledgeStore` — 知识条目 CRUD + 结构化存储
- `KnowledgeQuery` — 语义搜索 + 类型/标签过滤
- `KnowledgeLifecycle` — 知识生命周期: draft → candidate → validated → canonical → archived
- `KnowledgeIngest` — 知识摄取引擎
- `ReferenceTracker` — 知识引用关系图谱
- `KnowledgeLinter` — 知识质量检查(完整性/一致性/时效性)
- `ColdStartImporter` — 冷启动知识导入
- `KnowledgeHealthScorer` — 知识健康评分
- `KnowledgeLifecycleHooks` — 生命周期 hook

## 依赖关系
- 依赖 `src/types/` 知识相关类型
- 依赖 `src/monitoring/` KnowledgeDoctor / KnowledgeEvolver
- 被 `src/cli/commands/knowledge.ts` CLI 消费

## 约定
- 知识条目有明确的生命周期状态
- 约束退化时自动写入 KnowledgeStore
- Linter 检查完整性/一致性/时效性三个维度

## 注意事项
- Phase 1+4 实现的知识引擎核心
- 约束"退化不删除"——降级时保留规则原文 + 退化原因 + 历史数据
