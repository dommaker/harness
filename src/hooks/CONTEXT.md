# hooks/

## 职责
通用 Hook 管线：注册 → 排序 → 错误隔离 → 采样执行。无业务逻辑，consumer 自行定义 hook 名称和语义。

H5（#44）起增加两个机制（G2/G7）：
- **注册表闭环**：`assertHookRegistryClosed(configs, hooks)` 声明（HookConfig）↔ 实现（HookDefinition）双向校验——引用未注册/注册无定义/重复均抛错，复制 checker 闭环模式；断言限构建/测试期，不进运行时热路径
- **配置归一**：`HookConfig { name, enabled, errorStrategy }` 为 per-hook 配置唯一真相；`toErrorStrategy(blocking)` 承载 studio `blocking` → errorStrategy 的无损映射

## 核心导出
- `HookRegistry` — Hook 注册表（register/get/getEnabled/setEnabled/clear/listAll）
- `HookPipeline` — Hook 执行管线（注册/排序/错误隔离/采样；errorStrategy block/warn/ignore）
- `assertHookRegistryClosed` — 注册表闭环双向校验（构建/测试期）
- `HookConfig`（type）— per-hook 配置声明（归一后形状）
- `toErrorStrategy` — blocking → errorStrategy 无损映射（G7）
- `bootstrapHarness` / `bootstrapHarnessSync` — Harness 启动引导

## 依赖关系
- 依赖 `src/types/` Hook 相关类型
- 被 `src/core/` 核心引擎消费
- 被 CLI 初始化流程消费

## 约定
- 无业务逻辑，只提供管线能力
- Consumer 自行定义 hook 名称和触发时机
- **闭环**：声明配置与注册实现必须一一对应，缺一抛错（消灭「hook 定义不注册 = 死代码」类人记规矩）
- **映射语义**：blocking=true → 'block'（失败阻断管线，停止后续 hook、passed=false）；blocking=false → 'warn'（记录警告继续）；未声明 strategy 静默跳过（历史行为保留）
- 错误隔离：单个 hook 失败不影响其他 hook

## 注意事项
- 通用管线设计，不绑定特定生命周期
- 采样执行用于高频 hook(减少性能影响)
- 闭环断言是纯函数，由 consumer 在其注册点/测试中调用；harness 无内置 hook 定义，不自动断言
