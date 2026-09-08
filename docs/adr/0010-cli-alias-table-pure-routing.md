# ADR-0010: CLI 子命令别名合并——定义表退回纯路由

- 日期：2026-09-02
- 状态：已接受（2026-09-08 部分失效：`knowledge upsert`/`sync-status` 两子命令已迁出至 studio CLI，见 harness#110 与文末「后续变更」）
- 影响版本：随下个 minor 发布（无对外破坏：改动的类型不在包根导出面）

## 背景

架构评审（2026-09-02，候选 7）查实：`src/cli/commands/definitions.ts` 自称「纯数据模块」，实际 knowledge 13 子命令的 ~11 对别名（`list`/`ls`、`search`/`s`、`import`/`i`…）每对把 `impl + args` 闭包整块逐字复制两遍；全表 ~40 个闭包在做类型强转 / console.error / process.exit，数据表复杂度逼近引擎。别名复印是纯 locality 债：加一个别名 = 复制一个闭包块，改编组逻辑必须同改 N 份。

## 决策

- `CommandSubcommand` 形状改为 `{ impl, aliases?: string[], withPositionals? }`，**删除 `args` 闭包字段**；`CommandOptionRoute` 同步删除 `args`。别名进表为数据，bin 单循环经 `resolveSubcommand`（主名直查 + 别名遍历）解析，一名多解析不改 ADR-0007 的 CommandDefinition 对齐。
- 编组行为归位命令模块（那才是 interface/测试面）：
  - `knowledge search/s` → 新具名导出 `knowledgeSearchCommand(positionals, options)`（缺参闸门 + limit 强转），条目标 `withPositionals`，bin 以 `(positionals, options)` 调用
  - `passes-gate --coverage` → 新具名导出 `coverageCheck(options)`（projectPath 兜底 + 阈值强转），核心 `checkCoverage` 签名不动
  - `failure list` → `failureList` 自归一 `limit: number | string`
  - `knowledge upsert` → 默认值语义已在 handler 内（`|| ''`/`'architecture'`/`'cli'` 等价），参数放宽为可选
- 纯投影条目（commander options 与 handler 参数同名：list/import/decay/stats/sync-*/audit/snapshot/migrate/index/health/sdd/failure stats/clear/spec list）**不再传包装对象，原样透传 commander options**；handler 只读自己的键，多余键无害。
- 命令级 `mapActionArgs` 不动：单份闭包、无复印病灶，移出属正交重构（评审未点名）。

## 理由

- deletion test 通过：复印块删除后行为不消失（合并即得），纯债。
- 表格自此真正零闭包，「纯数据」从注释声明变成可验证事实（registry 冒烟只测 mapActionArgs/afterRun 两类仍存在的构造）。
- 加别名 = 加一个字符串；别名与主名结构上不可能漂移（同一条目）。

## 影响

- CLI 行为逐字不变（命令名/别名/选项/help/错误消息/退出码）：`registry.test.ts` 新增别名唯一性守卫 + 端到端用例钉死（`knowledge ls --json` 解析到 list 实现且仅加载 knowledge 模块；`kb s` 缺参提示逐字保持、exit 1；未知子命令报错不变）。
- 内部类型 `CommandSubcommand.args`/`CommandOptionRoute.args` 删除：不在包根导出面（ADR-0003 清单未含），对装包的人无感。
- `knowledgeUpsert` 参数 scope/title 由必填放宽为可选：程序内调用方全部传齐，无签名破坏。

## 后续变更

- 2026-09-08（harness#110 裁决）：`knowledge upsert`/`sync-status` 两子命令（硬编码 localhost Studio 内部端点的 HTTP 客户端，不属 harness「通用框架、文件驱动」定位）迁出至 studio 仓 CLI（`studio knowledge upsert`/`sync-status`，studio #452）。harness 侧删除 `knowledgeUpsert`/`knowledgeSyncStatus`、`definitions.ts` 两条路由（含别名 `up`/`sync`）及 upsert 专用 options（`--scope/--title/--content/--file/--source`）。本文「决策」第 4 条与「影响」第 3 条所述 `knowledge upsert` 条目随之失效，保留原文作历史记录。
