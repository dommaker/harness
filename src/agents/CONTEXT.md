# src/agents

Agent 生命周期模块 — Agent 的创建、执行、状态管理和生命周期钩子。

## 职责

- `lifecycle.ts` — Agent 生命周期管理（创建、启动、暂停、恢复、终止）
- `types.ts` — Agent 相关类型定义

## 核心导出

- `AgentLifecycle`
- Agent 状态和配置类型

## 依赖关系

- 被 `src/index.ts` 导出
- 依赖 `src/context/` 进行上下文管理
- 依赖 `src/safety/` 进行安全检查
- 依赖 `src/verification/` 进行循环检测

## 注意事项

- Agent 生命周期包含安全检查点
- 状态转换必须通过生命周期管理器，不能直接修改
