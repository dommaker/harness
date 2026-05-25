# governance/

## 职责
AI 治理：检测文档/配置/约束与代码的差异，输出差异报告。只检测不修复，由 LLM 自行修复。

## 核心导出
- `GovernanceExecutor` — 治理执行器: 运行所有检查、生成差异报告
- `types.ts` — DiffType / GovernanceDiff / GovernanceResult 类型

## 依赖关系
- 依赖 `src/core/constraints/` 约束检查
- 依赖 `src/monitoring/` 追踪/诊断数据
- 被 CLI 治理相关命令消费

## 约定
- "harness 检测差异，LLM 自行修复" — 不提供自动修复
- 差异类型(DiffType)可扩展
- 治理检查在 check / sync-docs 命令中触发

## 注意事项
- AI 治理简化(2026-05-03)：移除冗余 hook/apply
- GovernanceExecutor 是单例
