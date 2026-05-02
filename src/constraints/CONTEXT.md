# src/constraints

约束注册表和生命周期管理 — 分层约束注册、提案执行、废弃调度。

## 职责

- `registry.ts` — 分层约束注册表，支持约束的降级、回滚、废弃调度
- `lifecycle-runner.ts` — 执行约束变更提案（降级/回滚/添加例外/调整触发器/修改消息）
- `types.ts` — 约束注册表相关类型

## 核心导出

- `ConstraintRegistry` — 约束注册表
- `ConstraintLifecycleRunner` — 提案执行器
- `ConstraintProposal`, `ExecutionResult` 等类型

## 依赖关系

- 被 `src/index.ts` 导出
- 被 `src/monitoring/` 中的 ConstraintEvolver 生成提案
- 被 CLI `flow` 命令的 `--auto-execute` 选项使用

## 注意事项

- Iron Law（安全层）约束拒绝 level 变更
- 提案执行有安全层保护，防止误降级关键约束
