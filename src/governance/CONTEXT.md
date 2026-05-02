# src/governance

治理模块 — 检测项目中的文档和代码差异。

## 职责

- 检测 CAPABILITIES.md 与源码的同步状态
- 检测 CONTEXT.md 的存在和内容状态
- 输出结构化差异信息，供 LLM 或 CI 消费

## 核心导出

- `GovernanceExecutor` — 治理执行器类
- `governanceExecutor` — 全局单例
- `GovernanceDiff`, `DiffType`, `GovernanceResult` — 类型定义

## 依赖关系

- 被 `src/index.ts` 导出
- 被 `src/cli/commands/sync-docs.ts` 的 `--json` 选项间接使用（sync-docs 自行实现检测逻辑）

## 注意事项

- harness 只做检测，不做修复 — LLM 自行编辑文件
- 不需要 hook 机制 — LLM 自己就是 hook
- 不需要 apply 机制 — LLM 自己能编辑文件
- `sync-docs --check --json` 是 LLM 消费的主要入口
