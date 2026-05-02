# src/context

上下文管理模块 — Token 流水线、预算管理和渐进式加载。

## 职责

- Token 预算分配和管理
- 渐进式上下文加载（worker pool）
- 文件/工具输出的 token 预算
- 上下文压缩（compaction）
- 会话管理
- 知识注入器

## 核心导出

- `TokenBudget`, `ProgressiveLoader`, `FileBudget`, `ToolOutputBudget`
- `Compaction`, `TokenPipeline`, `SessionManager`
- `KnowledgeInjector`

## 依赖关系

- 被 `src/index.ts` 导出
- 被 CLI 命令和 agents 模块使用

## 注意事项

- 所有 token 计算是估算值，不调用 LLM
- 渐进式加载支持 worker pool 并行处理
