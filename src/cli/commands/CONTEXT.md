# cli/commands/

## 职责
CLI 子命令实现：24 个顶层命令 + constraints 治理子命令 report/retire（共 26 个命令文件），覆盖约束检查/门禁验证/文档同步/知识管理/失败诊断/发布/会话分析等。

## 核心导出(24 顶层命令)
check / validate / passes-gate / init / report / status / spec / acceptance / performance / security / contract / review / command / sync-docs / knowledge / sdd / failure / posteval-plan / release / analyze-sessions / update-user-model / constraints / doc-freshness-check / spec-baseline-check

`constraints` 下挂治理子命令：`constraints report`（使用统计 + 退役候选诊断 + 配置健康 + 注入漂移，`--export` 脱敏）、`constraints retire`（交互选择 + 人确认退役，config.yml retired 元数据 + KnowledgeStore 沉淀 + CLAUDE.md 注入段同步）。

## 依赖关系
- 依赖 `src/core/constraints/` 约束引擎
- 依赖 `src/gates/` 门禁系统
- 依赖 `src/monitoring/` 追踪/诊断
- 依赖 `src/knowledge/` 知识引擎
- 依赖 `src/failure/` 失败记录
- 被 `bin/harness.js` CLI 入口注册

## 约定
- 每个命令一个文件，命名与命令名一致
- 命令必须在 index.ts 中注册导出
- 命令选项类型命名规范：XxxOptions

## 注意事项
- 新增命令需同步更新 CLAUDE.md / CAPABILITIES.md / src/CONTEXT.md
- knowledge 命令包含 9 个子操作(list/search/import/decay/stats/upsert/sync-status/sync-rag)
