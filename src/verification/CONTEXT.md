# src/verification

验证循环模块 — 基于规则的验证和循环检测。

## 职责

- `rules-based.ts` — 基于规则的验证引擎
- `loop.ts` — 循环检测和防抖
- `types.ts` — 验证相关类型

## 核心导出

- `RulesBasedVerifier`
- `LoopDetector`

## 依赖关系

- 被 `src/index.ts` 导出
- 被 agents 模块在执行循环中使用

## 注意事项

- 循环检测防止 agent 陷入无限重试
- 规则验证器支持自定义规则
