# src/failure

失败处理模块 — 通用的错误分类和记录能力。

## 职责

- `classifier.ts` — 可扩展的错误分类器，支持自定义分类规则
- `recorder.ts` — 失败记录器，文件存储
- `types.ts` — 错误分类和记录的类型定义

## 核心导出

- `ErrorClassifier`, `createErrorClassifier`, `classifyError`
- `FailureRecorder`
- 错误分类规则类型

## 依赖关系

- 被 `src/index.ts` 导出
- 被 CLI 命令和监控模块使用

## 注意事项

- 分类规则可扩展，支持自定义规则注入
- 不包含业务逻辑，只提供通用能力
