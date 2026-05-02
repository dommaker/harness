# src/core

约束引擎核心 — 三层约束体系（Iron Laws / Guidelines / Tips）的评估和拦截。

## 职责

- `constraints/definitions.ts` — 23 条约束定义（8 Iron Laws + 13 Guidelines + 2 Tips）
- `constraints/checker.ts` — 约束评估器，根据 context 检查所有约束
- `constraints/interceptor.ts` — 操作拦截器，注册 enforcement executor，拦截操作前检查
- `validators/` — 检查点验证、CSO 验证、PassesGate 验证
- `session/` — 会话管理

## 核心导出

- `ConstraintChecker` — 约束检查单例
- `ConstraintInterceptor` — 操作拦截单例
- `checkConstraints()`, `checkBeforeExecution()` — 便捷函数

## 依赖关系

- 被 `src/index.ts` 导出为便捷 API
- 被 CLI 命令（check、validate 等）调用
- 依赖 `src/types/` 中的类型定义

## 注意事项

- Iron Law 违规必须抛出 `ConstraintViolationError`，不能静默通过
- 新增约束必须在 `definitions.ts` 中定义，并在 `checker.ts` 中实现检查逻辑
- `EXCEPTION_FIELD_MAP` 映射每条 guideline 的例外标志字段
