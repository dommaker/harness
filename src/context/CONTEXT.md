# context/

## 职责
上下文管理：Token 预算(多级分配)、渐进式加载(worker pool 并发)、文件/工具输出预算、会话压缩、Token 流水线、知识注入。

## 核心导出
- `TokenBudget` — 多级 token 预算(system/user/tool/reserve)
- `ProgressiveLoader` — 渐进式加载 + worker pool 并发
- `FileBudget` — 文件级 token 预算
- `ToolOutputBudget` — 工具输出 token 预算
- `Compaction` — 会话压缩(摘要/截断/滑动窗口)
- `TokenPipeline` — Token 流水线
- `SessionManager` — 会话管理
- `KnowledgeInjector` — 知识注入引擎

## 依赖关系
- 依赖 `src/types/` 公共类型
- 依赖 `src/core/` 核心模块
- 被 Agent 会话管理消费

## 约定
- Token 预算策略由配置文件控制
- 渐进式加载保证输入顺序(worker pool 模式)
- 会话压缩策略可组合

## 注意事项
- Phase 2 实现的 Token 流水线 + 预算 + 压缩
- 零 Token 成本：纯计算，不调用 LLM
