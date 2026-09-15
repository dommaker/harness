# hooks/

## 职责
通用 Hook 管线：注册 → 排序 → 错误隔离 → 采样执行。无业务逻辑，consumer 自行定义 hook 名称和语义。

H5（#44）起增加两个机制（G2/G7）：
- **注册表闭环**：`assertHookRegistryClosed(configs, hooks)` 声明（HookConfig）↔ 实现（HookDefinition）双向校验——引用未注册/注册无定义/重复均抛错，复制 checker 闭环模式；断言限构建/测试期，不进运行时热路径
- **配置归一**：`HookConfig { name, enabled, errorStrategy }` 为 per-hook 配置唯一真相；`toErrorStrategy(blocking)` 承载 studio `blocking` → errorStrategy 的无损映射（现状偏差见「注意事项」最后一条）

## 核心导出
- `HookRegistry` — Hook 注册表（register/registerAll/unregister/get/getEnabled/listNames/listAll/setEnabled/clear）
- `HookPipeline` — Hook 执行管线（注册/排序/错误隔离/采样；errorStrategy block/warn/ignore）
- `assertHookRegistryClosed` — 注册表闭环双向校验（构建/测试期）
- `HookConfig`（type）— per-hook 配置声明（归一后形状）
- `toErrorStrategy` — blocking → errorStrategy 无损映射（G7）
- `bootstrapHarness` / `bootstrapHarnessSync` — Harness 启动引导；也是 trace 记录器的组合根：`new ConstraintChecker(new TraceCollector({ projectPath }))`（harness#88 接线，core 不上行依赖 monitoring，故由本层接线；#139 收根：两个入口本就收 projectPath，落点随之锚定，不再取 cwd 锚定的 `getTraceCollector()` 单例）

## 依赖关系
- 类型正本在**本模块** `src/hooks/types.ts`（`HookPhase`/`HookErrorStrategy`/`HookConfig`/`HookDefinition`/`HookResult`/`PipelineResult`）；`src/types/` 里没有 hook 类型，本层只从 `src/types/project-config` 取 `MergedConstraintsConfig` 类型
- 向下依赖（仅 `bootstrap.ts` 组合根）：`core/constraints/checker`、`core/project-config-loader`、`context/session-manager`、`monitoring/traces`——`registry/pipeline/config/types` 四文件零上层依赖，是纯管线
- 消费方：包根 `src/index.ts` 的 `./hooks` 出口与下游项目（studio 的 hook 装配）。**harness 内部无生产消费方**——core/cli 侧的调用边已随零消费者清账删除（harness#141 同判据，ADR-0022），「被 core 核心引擎/CLI 初始化流程消费」的旧说法已失效（harness#142 核对）

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
- **已知偏差：`HookConfig` 的 `enabled` / `errorStrategy` 两字段无任何读取点**（harness#142 核对出，判「文档正确、代码待改」，缺陷票 #159）。执行读的是 `HookDefinition` 上的同名字段（`registry.getEnabled()` 滤 `hook.enabled !== false`、`pipeline` 取 `hook.errorStrategy`），`assertHookRegistryClosed` 只按 `name` 双向配对，因此声明与实现可在 enabled/strategy 上互相矛盾而不报错——「配置归一走 errorStrategy」目前只在定义侧成立。修法（把配置合并进定义 / 断言两字段一致 / 按 ADR-0022 判据删死字段）属缺陷票裁决范围，本层现状不改
