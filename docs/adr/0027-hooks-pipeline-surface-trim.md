# ADR-0027: hooks 管线面零消费者收缩——registry/pipeline/config/types 整体删除

- 日期：2026-09-17
- 状态：已接受
- 影响版本：下一个 minor（breaking 同车，沿用 ADR-0022「1.6.0/1.7.0 人类裁决 minor」口径，不进 major）
- 关联：#169（裁决票，三项裁定出处）；#167（`runOne` 来历）、#159（HookConfig 单点声明来历）；studio#562（hooks 层删除执行票，本 ADR 的事实前提）；ADR-0022（零消费者公共面收缩判据 + minor 同车先例）；ADR-0003（公共导出显式名单，裁决后变更）

## 背景

#167 落地 `HookPipeline.runOne(name, context)` 并随 **1.8.1（2026-09-17）发布**当日，其唯一需求方消失：studio#562 裁决（2026-09-17）确定 studio hooks 层整体收缩——7 个业务 hook 的注册管线零生产调用，唯一按名直调点位于无生产调用方的死路径，整层删除（裁决 ADR：studio `docs/adr/2026-09-17-hooks-layer-shrink.md`）。

事实核查（2026-09-17，#169 裁决过程，双仓）：

- **harness 内部零消费**：`HookRegistry` / `HookPipeline` / `assertHookRegistryClosed` / `toErrorStrategy` 仅在 `src/index.ts:354,365` 被 re-export，CLI/bin/其余 src 零调用方。
- **studio 消费随 studio#562 归零**：其对上述符号与 `HookConfig` 的全部消费位于待删的 hooks 层。
- **bootstrap 面有真实消费，不在收缩范围**：`bootstrapHarness()` 经 studio-shared `runtime/bootstrap.ts` 被 `apps/api/src/index.ts:122` 生产调用。但调用**无参**——`registerInitialHooks` 生产从不执行；且 studio 从不访问 `HarnessBootstrap.hooks` / `.pipeline`（studio-shared 仅以类型持有/转发该结构）。bootstrap 内部 new 出的 registry/pipeline 是永久空壳。
- **`runOne` 外部拾取概率极低**：发布至今不足一日。

## 决策（#169 三项裁定，2026-09-17 人类裁决）

1. **范围——管线面整体删**：`src/hooks/registry.ts` / `pipeline.ts` / `config.ts` / `types.ts` 删除，`src/hooks/index.ts` barrel 与 `src/index.ts` 导出面随迁，配套测试（`hooks/__tests__/{registry,pipeline,config}.test.ts`、`src/__tests__/hooks-pipeline.test.ts` 等逐项核实）随迁，三道公共面冻结闸（public-exports / public-type-surface / public-value-surface）条目同步。只删 `runOne` 被否：会留下零消费者的注册闭环，日后还要再开一刀。
2. **发布级别——minor 同车**：沿用 ADR-0022 先例口径。`runOne` 发布不足一日，等 major 反而抬高反悔成本。
3. **框架定位——hooks 管线不算 harness 独立供给**：#159/#167 动机均为 studio 需求，内部零消费佐证。「零消费者收缩」判据成立。
4. **执行时机——排在 studio#562 执行完成之后**：「双仓零消费者」是事实前提；本 ADR 先做原则裁决，删除动作由下游执行票承接。

## bootstrap 面的连带形状变更

`bootstrap.ts` 保留（真实消费），但形状随管线面删除而变：

- `HarnessBootstrap` 删 `hooks` / `pipeline` 两字段；
- `bootstrapHarness` / `bootstrapHarnessSync` 删 `hookDefinitions` / `hookConfigs` 参数与 `registerInitialHooks`（含「缺 HookConfig 声明表即抛错」的 #159 闸——声明表语义随 hooks 层一同消失）；
- 对现有唯一调用方透明：studio 无参调用、不访问被删字段，`HarnessBootstrap` 在 studio-shared 仅作类型持有/转发。

## 影响

- 公开面（breaking，包根）：删 `HookRegistry` / `HookPipeline` / `assertHookRegistryClosed` / `toErrorStrategy` 四个值符号 + `HookDefinition` / `HookConfig` / `EffectiveHook` / `HookErrorStrategy` / `HookExecutionRecord` / `HookPhase` / `HookResult` / `PipelineResult` 八个类型；`HarnessBootstrap` 形状变更（删两字段）。保留：`bootstrapHarness` / `bootstrapHarnessSync` / `HarnessBootstrap`。
- 迁移路径 = 删引用（双仓核实 studio#562 后无引用；bootstrap 调用方无感）。
- 文档：`src/hooks/CONTEXT.md` 改写为 bootstrap 单面口径；`src/CONTEXT.md` 符号级提及同步。
- 测试：管线面自有测试随迁；bootstrap 测试（`hooks/__tests__/bootstrap.test.ts`）改写为无 hooks 字段的新形状。
