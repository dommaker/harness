# src/llm

LLM 适配器层 — harness 与外部 LLM 基础设施的桥梁。

## 职责

定义 `LLMAdapter` 接口，供业务层注入具体实现。harness 自身不调用 LLM。

## 核心导出

- `LLMAdapter` — 可注入的 LLM 接口（complete/chat/streamChat/summarize/extract）
- `DefaultLLMAdapter` — 默认实现，complete/chat/streamChat 抛出异常（需注入），summarize/extract 为零 token 的 regex 实现

## 依赖关系

- 无外部依赖，纯类型定义 + 默认实现
- 被 `src/index.ts` 导出，供业务层注入
- 业务层通过 `new DefaultLLMAdapter({ provider })` 或实现自定义 adapter

## 注意事项

- **这不是死代码** — 等待业务层注入自定义 `LLMAdapter` 实现
- `summarize()` 和 `extract()` 有零 token 的 regex 实现，可在无 LLM 时使用
- 不要在 harness 核心中直接调用 LLM，始终通过 adapter 接口
