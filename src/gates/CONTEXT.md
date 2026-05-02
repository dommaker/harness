# src/gates

质量门禁系统 — 统一的门禁接口，覆盖测试、审查、安全、性能、契约等维度。

## 职责

提供各种质量门禁，每个门禁实现 `GateResult` 接口：
- `PassesGate` — 测试通过率门禁
- `ReviewGate` — 代码审查门禁
- `SecurityGate` — 安全检查门禁
- `PerformanceGate` — 性能阈值门禁
- `ContractGate` — API 契约门禁（OpenAPI）
- `AcceptanceGate` — 验收标准门禁
- `CommandBlacklistGate` — 命令黑名单门禁

## 核心导出

所有门禁类及对应类型（GateResult, GateContext, *Config）

## 依赖关系

- 被 CLI 命令（passes-gate, review, security, performance, contract, acceptance, command）调用
- 依赖 `src/types/` 中的类型定义

## 注意事项

- 新增门禁必须实现 `GateResult` 接口
- 新增门禁必须有对应的 CLI 命令和测试文件
- 门禁配置通过 `*Config` 接口传入
