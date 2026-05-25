# agents/

## 职责
Agent 生命周期管理：Agent 状态机(init → running → paused → completed → failed)。

## 核心导出
- `types.ts` — Agent 生命周期类型定义
- `lifecycle.ts` — AgentLifecycle 状态机

## 依赖关系
- 依赖 `src/types/` 公共类型
- 被 `src/context/session-manager.ts` 消费

## 约定
- Agent 状态机 5 状态: init → running → paused → completed → failed
- 状态转换由事件驱动
- 生命周期管理不包含业务逻辑

## 注意事项
- Phase 2 实现的 Agent 状态管理
- 状态转换可被外部监听(hook)
