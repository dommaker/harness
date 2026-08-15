# cli/commands/

## 职责
CLI 子命令实现：24 个顶层命令 + constraints 治理子命令 report/retire，覆盖约束检查/门禁验证/文档同步/知识管理/失败诊断/发布/会话分析等。

H5（#44）起：
- **命令定义即注册**：`definitions.ts` 的 `COMMAND_DEFINITIONS` 是命令形状（名称/别名/位置参数/选项/子命令/实现引用）的单一来源；bin/harness.js 遍历本表注册表驱动生成，不再手写 commander 命令块，不再有 index.ts barrel 两处同步（R6）
- **per-command 懒加载**（O2）：定义表存实现引用 `{ module, export }`，bin 只在 action 执行时 require 对应命令模块，任一命令执行不再加载全部命令实现

## 核心导出
- `COMMAND_DEFINITIONS`（definitions.ts）— 全部非门禁命令定义（纯数据模块，禁止 import 命令实现）
- 各命令文件：check / validate / passes-gate / init / report / status / spec / sync-docs / knowledge / sdd / failure / posteval-plan / release / analyze-sessions / update-user-model / constraints / doc-freshness-check / spec-baseline-check
- 6 门禁命令实现在 `acceptance` / `command` / `contract` / `performance` / `review` / `security`（其 CLI 元数据在 `src/gates/definitions.ts`）

`constraints` 下挂治理子命令：`constraints report`（使用统计 + 退役候选诊断 + 配置健康 + 注入漂移，`--export` 脱敏）、`constraints retire`（交互选择 + 人确认退役；带 id 直达需显式 `--yes`（#24 人确认闸门），无 `--yes` 报错 + 非零退出码且不落盘；内置落 config.yml retired 元数据，custom 落 custom-constraints.yml 条目 retired 段（#82 D6 一处真相）+ KnowledgeStore 沉淀 + CLAUDE.md 注入段同步）。

## 依赖关系
- 依赖 `src/core/constraints/` 约束引擎
- 依赖 `src/gates/` 门禁系统
- 依赖 `src/monitoring/` 追踪/诊断
- 依赖 `src/knowledge/` 知识引擎
- 依赖 `src/failure/` 失败记录
- 被 `bin/harness.js` CLI 入口按定义表驱动生成

## 约定
- 每个命令一个实现文件，命名与命令名一致（sync-docs 为模块族目录）
- **新增命令 = 命令实现文件 + definitions.ts 一条定义（含 CLI 元数据与实现引用）+ 测试**，不再改 bin/harness.js
- **definitions.ts 是纯数据模块**：禁止 import 任何命令实现/运行时依赖（保 --help/--version 懒加载）；实现引用可解析性由 `__tests__/registry.test.ts` 构建/测试期断言
- 命令选项类型命名规范：XxxOptions

## 注意事项
- 新增命令需同步更新 CLAUDE.md / CAPABILITIES.md / src/CONTEXT.md
- knowledge 命令包含 13 个子操作（list/search/import/decay/stats/upsert/sync-status/sync-rag/audit/snapshot/migrate/index/health）
- 特殊路由（选项条件、子命令兜底、退出码处理）表达在定义表的 optionRoutes / subcommands / afterRun 字段，bin 是纯通用引擎、不含单命令知识
