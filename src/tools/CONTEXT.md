# src/tools

工具注册表 — 工具的注册、发现、加载和执行管理。

## 职责

- `registry.ts` — 工具注册表，管理工具的注册和发现
- `core.ts` — 核心工具定义
- `loader.ts` — 工具加载器
- `paths.ts` — 工具路径管理
- `types.ts` — 工具相关类型

## 核心导出

- `ToolRegistry`
- 核心工具和工具类型

## 依赖关系

- 被 `src/index.ts` 导出
- 工具定义存储在 `tools/definitions/` 目录

## 注意事项

- 工具定义使用 JSON Schema 描述参数
- 工具执行前需通过 `src/safety/tool-guardrail.ts` 安全检查
