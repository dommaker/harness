# gates/

## 职责
质量门禁系统：6 种门禁检查（验收/命令/契约/性能/审查/安全）。统一 Gate 三态协议 + 注册表闭环 + 声明式生效集（G1）。

## 核心导出
- 统一协议：`Gate{id, order, evaluate(ctx)}` → `GateDecision{status: deny|abstain|ask, result: GateResult}`（`types.ts`；`decisionFromResult` 报告→决策映射，浅冻结）
- 注册表：`gateRegistry`（`registry.ts`）——定义即注册 + 构建期双向闭环（定义无实现/实现无定义/重复 id → 加载期抛错）；`getGate`（未注册抛错）/`listRegisteredGates`/`registeredGateCount`
- 定义表：`GATE_DEFINITIONS`（`definitions.ts`）——id/description/默认 order/CLI 元数据；bin/harness.js 注册表驱动生成 6 门禁命令（纯数据模块，禁 import 实现，保 --help 懒加载；CLI 实现引用为 module+export，per-command 懒加载，H5）
- 执行器：`runGates`（`runner.ts`）——按 order 升序；deny 单调（下游 abstain 不得改回 allow）+ ask 枚举预留 fail-closed = deny；决策浅冻结
- 生效集：`getEffectiveGates(projectRoot)`（`effective-gates.ts`）——对齐 getEffectiveConstraints 裁剪模式：config.yml `gates.order` 重排 + `gates.<id>.enabled:false` 移除；enabled 段未注册校验与裁剪走 core/effective-set 共享筛选器（throw 模式），order 重排与重复 id 检测留本侧
- checker-as-guard 接线点：`createCheckerGate(check)`（`checker-gate.ts`）——ConstraintCheck → Gate（studio #129 随动）；false→deny，true/'skip'→abstain；env 经 `buildCheckEnv(..., 'none')` 构造（显式不接证据，语义见 core/constraints/checkers/types.ts 工厂 doc）
- 门禁类：`ReviewGate` / `SecurityGate` / `PerformanceGate` / `ContractGate` / `SpecAcceptanceGate` / `CommandGate`（各自执行细节私有，保留 `check()`/`scan()` 报告方法）
- `types.ts` — GateResult（报告结构，保留）/ GateContext / GateDecision 等公共类型
- 便捷工厂函数：createReviewGate / createSecurityGate / createPerformanceGate / createContractGate / createSpecAcceptanceGate / createCommandGate

## 依赖关系
- 依赖 `src/core/`（effective-gates 读 project-config-loader；checker-gate 适配 checkers 注册表类型）
- 依赖 `src/types/` 公共类型

## 约定
- 新门禁必须：① 在 `definitions.ts` 补 GateDefinition（含 CLI 元数据）② 在 `registry.ts` IMPLEMENTATIONS 注册实现（缺一 → 加载期抛错）③ 实现统一 Gate 接口（evaluate 产三态决策，报告走 GateResult）④ 配 CLI 命令（命令实现文件 + CLI 元数据的 module+export 引用，bin 由定义表驱动生成，不再手写块）+ 测试文件
- deny 单调是接口契约：决策浅冻结，下游不得改写上游决策
- ask 枚举预留：暂无实现，runGates fail-closed 按 deny 计

## 注意事项
- 门禁系统不包含业务逻辑，只提供检查能力
- 统一的是决策协议（id/order/三态），执行细节（gh pr view/正则黑名单/OpenAPI diff/benchmark）私有——不要把执行细节塞进 Gate 接口
- config.yml gates 段为新增面：引用未注册 id 直接抛错（无历史残留配置需兼容）
- CommandGate 为命令黑名单检查(SEC-006)
