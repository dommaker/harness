# src/cli/commands

CLI 命令模块 — harness CLI 的所有子命令实现。

## 职责

每个文件实现一个 CLI 子命令：
- `check` — 约束检查
- `validate` — 验证
- `passes-gate` — 测试门禁
- `init` — 项目初始化（含 governance 配置）
- `report` — 报告生成
- `status` — 状态查看
- `flow` — 约束演化流程
- `spec` — Spec 检查
- `acceptance` / `performance` / `security` / `contract` / `review` / `command` — 各门禁命令
- `sync-docs` — 文档同步（含 governance hook 支持）

## 核心导出

所有命令函数及选项类型

## 依赖关系

- 被 `bin/harness.js` 导入并注册为 commander 子命令
- 调用 `src/core/`, `src/gates/`, `src/governance/` 等模块

## 注意事项

- 每个新门禁必须有对应的 CLI 命令
- 命令注册在 `index.ts` 中，同时需在 `bin/harness.js` 中添加 commander 注册
- `init` 命令支持 `--governance` 选项初始化治理配置
- `sync-docs` 命令支持 `--hooks` 选项启用治理 hook
