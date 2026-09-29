# context/

## 职责
上下文管理：会话管理、知识注入。

## 核心导出
- `SessionManager` — 会话管理
- `KnowledgeInjector` — 知识注入引擎；`origin === 'external'` 条目注入时带 `[External Source — verify before acting]` 前缀（标记唯一正本是 `knowledge/query.ts` 的 `EXTERNAL_SOURCE_MARKER`，本目录不另存字面量），注入 source 的 metadata 带 `entryId`/`maturity`/`origin`（外部内容三层防御第二层，harness#161）

## 依赖关系
- 依赖 `src/knowledge/`（`knowledge/types` 类型 + `knowledge/query` 的 `KnowledgeQuery`/`EXTERNAL_SOURCE_MARKER` 值）、`src/utils/`（jsonl）
- 仓内消费方只有 `src/index.ts` 的公共导出 re-export（`./context` 子路径面）

## 约定
- 压缩只剩词汇不留引擎：`types.ts` 保留 `CompactionLevel`（被 `CompactionConfig` 引用）与 `CompactionConfig`，但 `SessionCompaction` 引擎、`CompactionResult`、`DEFAULT_COMPACTION_CONFIG` 与 `AdaptiveTokenBudget` 已随 ADR-0022（零生产消费者）删除，本目录不再提供压缩策略组合点
- `TokenBudget` 与 `ContextTracker`（含 `ContextUsageSnapshot`/`ContextAverages` 类型、SessionManager 的 tracker 接线）已随 #199（ADR-0038，双仓零编程消费者）删除

## 注意事项
- 零 Token 成本：纯计算，不调用 LLM
- Phase 2 前瞻的渐进式加载/Token 流水线/文件与工具输出预算已随 H1（#40）删除
