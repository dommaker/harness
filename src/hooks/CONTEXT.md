# hooks/

## 职责
通用 Hook 管线：注册 → 排序 → 错误隔离 → 采样执行。无业务逻辑，consumer 自行定义 hook 名称和语义。

## 核心导出
- `HookRegistry` — Hook 注册表
- `HookPipeline` — Hook 执行管线(注册/排序/错误隔离/采样)
- `bootstrapHarness` / `bootstrapHarnessSync` — Harness 启动引导

## 依赖关系
- 依赖 `src/types/` Hook 相关类型
- 被 `src/core/` 核心引擎消费
- 被 CLI 初始化流程消费

## 约定
- 无业务逻辑，只提供管线能力
- Consumer 自行定义 hook 名称和触发时机
- 错误隔离：单个 hook 失败不影响其他 hook

## 注意事项
- 通用管线设计，不绑定特定生命周期
- 采样执行用于高频 hook(减少性能影响)
