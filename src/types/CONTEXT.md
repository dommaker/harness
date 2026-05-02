# src/types

类型定义模块 — 全局共享的 TypeScript 类型。

## 职责

- `constraint.ts` — 约束体系类型（ConstraintTrigger, ConstraintContext, ConstraintResult 等）
- `checkpoint.ts` — 检查点类型
- `passes-gate.ts` — 门禁类型
- `cso.ts` — CSO 类型
- `trace.ts` — 追踪类型（ExecutionTrace）
- `performance.ts` — 性能类型
- `project-config.ts` — 项目配置类型（含 GovernanceConfig）

## 核心导出

所有共享类型

## 依赖关系

- 被 `src/index.ts` 导出
- 被几乎所有其他模块引用

## 注意事项

- 这是纯类型模块，不包含运行时逻辑
- 新增共享类型应放在此目录
- 向后兼容：保留 `IronLaw*` 类型别名
