# src/architecture

架构级约束检查 — 跨模块、跨项目的架构规则验证。

## 职责

- `constraint-engine.ts` — 架构约束引擎，支持 4 种规则：forbidden-pattern / file-count / module-boundary / custom
  - `module-boundary` — 解析 git diff 中的 import 语句，检测跨模块违规导入
- `cross-project-checker.ts` — 跨项目接口契约检查（API 同步、类型一致性、破坏性变更、文档-代码一致性）

## 核心导出

- `ConstraintEngine` — 架构约束引擎
- `CrossProjectChecker` — 跨项目检查器

## 依赖关系

- 被 `src/index.ts` 导出
- 被 CLI 命令调用

## 注意事项

- `cross-project-checker` 中部分函数为 stub 实现（待完善）
- 依赖 git 命令获取 diff 信息
