# context/

## 职责
上下文管理：Token 预算(多级分配)、会话管理、知识注入。

## 核心导出
- `TokenBudget` — 多级 token 预算(system/user/tool/reserve)
- `SessionManager` — 会话管理
- `KnowledgeInjector` — 知识注入引擎

## 依赖关系
- 依赖 `src/types/` 公共类型
- 依赖 `src/core/` 核心模块
- 被 Agent 会话管理消费

## 约定
- Token 预算策略由配置文件控制
- 压缩只剩词汇不留引擎：`types.ts` 保留 `CompactionLevel`（被 `ContextUsageSnapshot.compactionLevel` 引用）与 `CompactionConfig`，但 `SessionCompaction` 引擎、`CompactionResult`、`DEFAULT_COMPACTION_CONFIG` 与 `AdaptiveTokenBudget` 已随 ADR-0022（零生产消费者）删除，本目录不再提供压缩策略组合点

## 注意事项
- 零 Token 成本：纯计算，不调用 LLM
- Phase 2 前瞻的渐进式加载/Token 流水线/文件与工具输出预算已随 H1（#40）删除
