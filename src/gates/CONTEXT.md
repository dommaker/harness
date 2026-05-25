# gates/

## 职责
质量门禁系统：6 种门禁检查（验收/命令/契约/性能/审查/安全）。

## 核心导出
- `ReviewGate` — 代码审查门禁
- `SecurityGate` — 安全检查门禁
- `PerformanceGate` — 性能门禁
- `ContractGate` — 契约(OpenAPI)门禁
- `SpecAcceptanceGate` — Spec 验收门禁
- `CommandGate` — 命令黑名单门禁
- `types.ts` — GateResult / GateContext 等公共类型
- 便捷工厂函数：createReviewGate / createSecurityGate / createPerformanceGate / createContractGate / createSpecAcceptanceGate

## 依赖关系
- 依赖 `src/core/` 类型(GateResult)
- 依赖 `src/types/` 公共类型

## 约定
- 所有门禁实现 GateResult 接口
- 新门禁必须配 CLI 命令 + 测试文件
- 工厂函数在 index.ts 中统一导出

## 注意事项
- 门禁系统不包含业务逻辑，只提供检查能力
- CommandGate 为命令黑名单检查(SEC-006)
