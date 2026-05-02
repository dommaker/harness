# src/knowledge

知识引擎 — 项目知识的存储、查询、生命周期管理和导入。

## 职责

- `store.ts` — 知识存储
- `query.ts` — 知识查询
- `lifecycle.ts` — 知识生命周期管理（过期、更新）
- `ingest.ts` — 知识摄入
- `reference-tracker.ts` — 引用追踪
- `lint.ts` — 知识 lint
- `import.ts` — 冷启动导入

## 核心导出

- `KnowledgeStore`, `KnowledgeQuery`, `KnowledgeLifecycle`, `KnowledgeIngest`
- `ReferenceTracker`, `KnowledgeLinter`, `ColdStartImporter`
- `KnowledgeLifecycleHooks`

## 依赖关系

- 被 `src/index.ts` 导出
- 被 `src/context/knowledge-injector.ts` 使用

## 注意事项

- 知识存储在 `.harness/knowledge/` 目录
- 冷启动导入支持从项目文件中自动提取知识
