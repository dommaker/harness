# tools/

## 职责
工具管理：工具类型定义、注册表、核心工具实现、加载器、路径管理。

## 核心导出
- `types.ts` — 工具类型定义
- `registry.ts` — 工具注册表
- `core.ts` — 核心工具实现
- `loader.ts` — 工具加载器
- `paths.ts` — 工具路径管理

## 依赖关系
- 依赖 `src/types/` 公共类型
- 被 `src/safety/tool-guardrail.ts` 消费
- 被 Agent 工具调用管线消费

## 约定
- 工具通过注册表统一管理
- 工具路径由 paths 模块解析
- loader 支持动态加载外部工具

## 注意事项
- 工具注册表与 ToolGuardrail 配合使用
- 路径管理支持多项目工具目录
