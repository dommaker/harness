# agents/

## 职责
Agent 生命周期管理：Agent 状态机（5 状态：idle/running/completed/failed/terminated）。

## 核心导出
- `types.ts` — Agent 生命周期类型定义
- `lifecycle.ts` — AgentLifecycle 状态机

## 依赖关系
- 无跨目录依赖（只引本目录 `types.ts`）
- 仓内唯一引用是 `src/index.ts` 的公共导出 re-export（跨仓消费面，ADR-0003）

## 约定
- Agent 状态机 5 状态: idle → running → completed / failed（terminated 为预留终态）
- 生命周期管理不包含业务逻辑

## 注意事项
- Phase 2 实现的 Agent 状态管理
