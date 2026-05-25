# safety/

## 职责
安全护栏：输入/输出/Tool Guardrail + 沙箱执行环境(L1-L4)。

## 核心导出
- `Sandbox` — 沙箱执行环境: 级别 L1-L4 / 资源限制 / 隔离策略
- `InputGuardrail` — 输入安全检查: 注入检测 / 敏感信息 / 格式校验
- `OutputGuardrail` — 输出安全检查: 泄露检测 / 有害内容 / 格式合规
- `ToolGuardrail` — 工具调用安全: 权限验证 / 参数校验 / 速率限制

## 依赖关系
- 依赖 `src/types/` 安全相关类型
- 被 Agent 执行管线消费

## 约定
- Guardrail 检查在操作前/后执行
- 沙箱级别 L1(最宽松) → L4(最严格)
- 安全策略由配置文件控制

## 注意事项
- Phase 3 实现的核心安全模块
- Guardrail 检查失败阻断执行(非警告)
