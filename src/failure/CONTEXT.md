# failure/

## 职责
失败处理：错误分类(可扩展规则)、失败记录(文件存储)、约束违规统一处理策略。

## 核心导出
- `ErrorClassifier` — 错误分类器(可配置规则)
- `FailureRecorder` — 失败记录器(文件存储)
- `ConstraintViolationHandler` — 约束违规处理: block / collect / safeBoolean 三种策略
- `types.ts` — 错误分类/记录类型定义

## 依赖关系
- 依赖 `src/types/constraint` ConstraintViolationError
- 依赖 `src/core/constraints/` 约束检查结果
- 被 `src/cli/commands/report.ts` 消费（executeWithCollect），并经包根导出

## 约定
- 分类规则可扩展(自定义 ErrorClassifierConfig)
- 失败记录存储在 .harness/ 目录
- 不包含业务逻辑，只提供通用能力

## 注意事项
- S4 统一处理策略：executeWithBlock / executeWithCollect / executeWithSafeBoolean
- 分类器基于规则匹配，不调用 LLM
