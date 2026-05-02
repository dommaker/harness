# src/safety

安全护栏模块 — 输入/输出/工具调用的安全检查。

## 职责

- `sandbox.ts` — 沙箱执行环境
- `input-guardrail.ts` — 输入安全检查（prompt injection 检测等）
- `output-guardrail.ts` — 输出安全检查（敏感信息泄露检测等）
- `tool-guardrail.ts` — 工具调用安全检查

## 核心导出

- `Sandbox`, `InputGuardrail`, `OutputGuardrail`, `ToolGuardrail`

## 依赖关系

- 被 `src/index.ts` 导出
- 被 agents 模块在执行前/后调用

## 注意事项

- 安全护栏是 Iron Law 级别，违规必须阻断执行
- 沙箱提供隔离执行环境，防止危险操作
