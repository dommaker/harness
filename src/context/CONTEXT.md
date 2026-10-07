# context/

## 职责
上下文管理：会话管理。

## 核心导出
- `SessionManager` — 会话管理（fail-fast：事件/checkpoint 写失败、checkpoint JSON 损坏、会话目录 IO 故障一律抛出，不再静默吞；「磁盘无数据 → undefined」「checkpoint 查无 → 抛『不存在』」两个语义分支保留）

## 依赖关系
- 依赖 `src/utils/`（jsonl）
- 仓内消费方：`src/index.ts` 的公共导出 re-export（`./context` 子路径面）+ `src/bootstrap/bootstrap.ts` 直引并构造 `SessionManager`

## 约定
- 知识注入不属本目录：`KnowledgeInjector`（含 `InjectionConfig`/`InjectionResult`）是消费编排，按 repositioning 定位裁决归下游编排消费方（唯一消费方），harness 侧已删除；外部来源标记标准正本保留在 `knowledge/query.ts` 的 `EXTERNAL_SOURCE_MARKER`（包根公开导出，供消费方格式化时对齐）
- 压缩面整体退场：`SessionCompaction` 引擎、`CompactionResult`、`DEFAULT_COMPACTION_CONFIG` 与 `AdaptiveTokenBudget` 随 ADR-0022 删除后，残留的词汇类型（`CompactionConfig`/`CompactionLevel`/`ContextSource`/`ContextSourceType`/`SessionMessage`）双仓零消费者，已随 ADR-0041 Phase 4 连本体删除
- `TokenBudget` 与 `ContextTracker`（含 `ContextUsageSnapshot`/`ContextAverages` 类型、SessionManager 的 tracker 接线）已随 #199（ADR-0038，双仓零编程消费者）删除

## 注意事项
- 零 Token 成本：纯计算，不调用 LLM
- Phase 2 前瞻的渐进式加载/Token 流水线/文件与工具输出预算已随 H1（#40）删除
