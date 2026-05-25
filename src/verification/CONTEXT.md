# verification/

## 职责
验证引擎：基于规则的验证 + 循环验证(loop verification)。

## 核心导出
- `types.ts` — 验证类型定义
- `rules-based.ts` — 基于规则的验证引擎
- `loop.ts` — 循环验证引擎

## 依赖关系
- 依赖 `src/core/constraints/` 约束检查
- 依赖 `src/core/validators/` 验证器
- 被 CLI flow 命令消费

## 约定
- 验证规则可配置
- loop 验证用于持续监控场景
- 验证结果包含 pass/fail + 详细信息

## 注意事项
- 与 core/validators 配合使用
- loop 验证适用于长期运行的 Agent 会话
