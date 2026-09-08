# harness↔studio 非代码耦合面盘点（wayfinder #72 / 研究票 #74）

> 日期：2026-08-31。范围：运行时数据布局、模板依赖、跨仓脚本、部署/配置仓四个**非代码**面。
> 只盘点事实，去向裁决归 #75（grilling 票）。代码 API 消费面已由 #73 覆盖，本文不重复。
> 路径约定：`harness/` = harness 仓，`studio/` = studio 仓，`studio-prod/` = 生产 checkout，`studio-config/` = 部署配置仓；行号为盘点当日 master 实测。

## 0. 结论摘要表

| 面 | 发现数 | 性质分布 | 最突出的一条 |
|----|--------|----------|--------------|
| (a) 运行时数据布局 | 5 | 实耦合 3 + 残留/分叉 2 | harness CLI `knowledge` 默认读写 `~/.studio/knowledge`（反向硬编码 studio 数据根） |
| (b) 模板依赖 | 3 | 死分支 1 + 深路径 1 + 发布面 1 | worktree-resolver 的 `templates/node-api/.harness` fallback 是死分支（模板里从未有过 `.harness`），静默失败 |
| (c) 跨仓脚本 | 6 | 活跃 3 + 僵尸/stale 3 | studio-config 仍持有 studio 已删的三个脚本，且 CI 钉 `@dommaker/harness@^0.8.3` 僵尸版本 |
| (d) 部署/配置仓 | 5 | 实耦合 5 | studio-ship / studio-deploy-quick 深度调用 harness CLI 且模拟 CI 时挪动 `.harness/config.yml`——CLI 行为变化历史上多次炸过部署（SHIP.md 事故表） |

合计 19 条。版本口径现状：studio 6 个 manifest 全部 `^1.2.3`，harness 仓 `package.json:3` = 1.2.3，studio-prod 实装 1.2.3 —— 三方当前同步。

## (a) 运行时数据布局共享

实测 `~/.harness/` 当前为空目录（2026-08-31 创建，无内容）；`~/.studio/` 下存在 `.harness/routing.jsonl`（最后写入 2026-06-26）与 `knowledge/` 等。

| # | 事实 | 证据 |
|---|------|------|
| a1 | **`~/.harness/audit/{date}.jsonl` 是 studio 侧自造的全局 home 目录，harness 从不使用 `~/.harness`**。写方 = `studio/packages/studio-shared/src/harness/hooks/audit.ts:27`（`getAuditDir() = os.homedir()/.harness/audit`）+ `:55`（`appendFileSync`）。harness 仓内 `os.homedir()` 全部命中 `~/.studio`、`~/.claude`，无一指向 `~/.harness`（harness 自身一律用项目级 `.harness/`）。文件无活跃读方（消费走 EventBus → DB，见 `studio/apps/api/src/modules/audit/CONTEXT.md:5`） | `studio/packages/studio-shared/src/harness/hooks/audit.ts:4,25-28,55`；`harness/src/cli/commands/knowledge.ts:505`、`analyze-sessions.ts:57-58`、`update-user-model.ts:51-52`（harness 全部 homedir 命中，无 `.harness`） |
| a2 | **studio 直读 harness 项目级运行时状态文件**：① traces：`<repoRoot>/.harness/logs/traces.log`（harness `TraceCollector` 写，路径常量在 `harness/src/types/trace.ts:13`）；② failures：`FailureRecorder` 指向 `.harness/logs/failures.log`；③ 约束配置：`readFileSync` 直读 `.harness/config.yml` / `custom-constraints.yml`；④ proposals：读写 `process.cwd()/.harness/proposals/`。②③④ 都是 studio 自己拼路径读 harness 拥有的文件布局 | `studio/apps/api/src/modules/evolution/signals.ts:5-7,42`；`studio/apps/api/src/modules/harness/diagnostics.routes.ts:62`、`studio/packages/studio-shared/src/harness/hooks/completion.hooks.ts:49`；`studio/apps/api/src/modules/harness/constraints.routes.ts:35,52`；`studio/apps/api/src/modules/harness/proposals.routes.ts:31,69,108` |
| a3 | **反向：harness CLI `knowledge` 命令默认知识库目录硬编码为 `~/.studio/knowledge`**（可用 `KNOWLEDGE_BASE_DIR` 或 `--project` 覆盖，覆盖后走 `<project>/.harness/knowledge`）。`harness sync-docs` 生成的知识入口指引同样写死 `~/.studio/knowledge/_index.md` | `harness/src/cli/commands/knowledge.ts:502-506`；`harness/src/knowledge/index-generator.ts:62`；测试锁定该默认：`harness/src/cli/commands/__tests__/knowledge.test.ts:96-97` |
| a4 | **failures.log 路径口径分叉**：harness CLI 自己用 `.harness/failures/failures.log`，studio 侧实例化 `FailureRecorder` 用 `.harness/logs/failures.log`（与 harness `recorder.ts:28` 文档示例一致）——同一文件两套约定 | `harness/src/cli/commands/failure.ts:24` vs `studio/apps/api/src/modules/harness/diagnostics.routes.ts:62`、`studio/packages/studio-shared/src/harness/hooks/completion.hooks.ts:49` |
| a5 | **`~/.studio/.harness/routing.jsonl` 为历史残留**：现行代码无任何读写（全仓 grep 仅命中 legacy SDD 与一处过时注释），文件本体仍在。harness 命名的子目录嵌在 studio 数据根内 | `studio/apps/api/src/modules/agents/monitor/monitor-reports.ts:122`（注释）；`studio/.studio/legacy-sdd/kb-optimize-phase1/design.md:178`（历史设计） |

## (b) 模板依赖

| # | 事实 | 证据 |
|---|------|------|
| b1 | **#150 后现状：主路径已改为从调用仓自身 `.harness/` 复制三件套**（`config.yml`/`checkpoints.yml`/`custom-constraints.yml`），`templates/` 仅在 cwd 无 `.harness` 时作 fallback | `studio/packages/studio-agent/src/services/worktree-resolver.ts:186-196`（主路径）、`:197-205`（fallback） |
| b2 | **该 fallback 是死分支**：harness 仓 `templates/node-api/` 只有 `package.json`/`src`/`tsconfig.json`/`.github`，**从未存在过 `.harness` 子目录**（`git log -- templates/node-api/.harness` 无记录）；npm 包 1.2.3 内同样没有。`cp -r ... 2>/dev/null \|\| true` 静默吞错——worktree 拿不到 harness 配置也不报任何错 | `harness/templates/node-api/`（目录实测）；`studio/packages/studio-agent/src/services/worktree-resolver.ts:198-204` |
| b3 | **对 harness 包内部文件布局的依赖仍在两处**：① `require.resolve('@dommaker/harness/package.json')` → `templates/node-api`（b2 死分支）；② `require.resolve('@dommaker/harness')` 根导出 → 拼 `dist/pretool-use-hook.js`（#154 出厂 shim，活跃路径）。`templates/` 与 `dist` 都在 npm `files` 字段内随包发布，harness 侧挪动文件即破坏 studio——② 是实打实的破坏半径，① 已名存实亡 | `studio/packages/studio-agent/src/services/worktree-resolver.ts:198`；`studio/packages/studio-agent/src/services/provider-hooks.ts:13-14,24-28`；`harness/package.json:46-51`（`files: [dist, bin, src, templates, ...]`） |

## (c) 跨仓脚本

| # | 事实 | 证据 |
|---|------|------|
| c1 | **票面点名的 `spec-gate.ts` / `cross-project-check.ts` / `architect-check.ts` 已从 studio 删除**（2026-08-18，#208）：harness 1.0 删除 `runArchitectureCheck`/`checkCrossProjectContracts` 等 API 后三脚本 import 即崩，整体删除。这本身就是「harness 删 API → studio 脚本崩」耦合史的直接证据 | studio commit `0c5cc8fb`（`fix(scripts): 删除 harness 1.0 已删模块的残留引用脚本（#208）`，删 572 行） |
| c2 | **但同三脚本仍存于 studio-config 且仍 import 已删 API**；其 CI `spec-gate.yml` 安装 `@dommaker/harness@^0.8.3`——版本口径停在 0.8.x，属僵尸耦合（现行 harness 1.2.3 下必崩） | `studio-config/scripts/tools/{spec-gate,cross-project-check,architect-check}.ts:15-27`；`studio-config/.github/workflows/spec-gate.yml:34` |
| c3 | **`studio/scripts/harness-upgrade.ts` 活跃**：依赖 npm registry（`npm view`）、`git ls-remote` harness 仓 tags、包导出面对比（`node -e require('@dommaker/harness')`）；改写全仓 6 个 package.json 后 **auto-commit + push master**（`--no-verify`） | `studio/scripts/harness-upgrade.ts:127-134`（npm view）、`:142`（ls-remote）、`:169-179`（导出对比）、`:107-117`（auto push） |
| c4 | **`studio/scripts/harness-sync.js` 活跃**：postinstall + prepare 钩子，比对 `node_modules/@dommaker/harness/package.json` 版本 vs `.harness/config.yml` 的 `version:` 字段，不一致自动 `npx harness init`——npm 版本、config.yml schema、harness CLI 三重耦合，且每次 install 都触发 | `studio/scripts/harness-sync.js:1-40`；`studio/package.json:43-44`（postinstall/prepare） |
| c5 | **stale 脚本两处**：`sync-harness.sh` 硬编码目标为已不存在的 `agent-studio` 路径（开发期飞轮残留）；`arch-doc-diff.ts` 硬编码跨仓路径 `PROJECTS_ROOT/harness/package.json` 与仓库清单 `['harness','agent-platform','agent-studio']` | `studio/scripts/sync-harness.sh:12-14`；`studio/scripts/tools/arch-doc-diff.ts:60,153` |
| c6 | **npm 版本口径当前同步**：studio 根 + 5 个子包 manifest 全部 `"@dommaker/harness": "^1.2.3"`；harness 仓 `package.json:3` = 1.2.3；studio-prod 实装 1.2.3 | `studio/package.json:65`、`studio/packages/{studio-agent,studio-capability,studio-shared,studio-spec}/package.json:15/59`、`studio/apps/api/package.json:16`；`harness/package.json:3` |

## (d) 部署/配置仓

| # | 事实 | 证据 |
|---|------|------|
| d1 | **systemd `studio-api.service` 本身不直接引用 harness CLI**；但 `REPO_DIR` 环境变量指向开发仓，daemon 的 worktree 传播链路（b 面）运行时依赖 studio-prod `node_modules` 内实装的 `@dommaker/harness@1.2.3`——部署物与 npm 包版本硬绑定 | unit 文件 `Environment=REPO_DIR=...`（studio-config/SHIP.md 同述）；studio-prod `node_modules/@dommaker/harness/package.json` = 1.2.3 |
| d2 | **`studio-ship` 深度耦合 harness CLI 与 `.harness/config.yml` 语义**：流程内 `npx harness check` / `sync-docs --agents` / `sync-docs --check --agents`，且为模拟 CI 环境把 `.harness/config.yml` 临时挪走再复原；git add 需显式排除 `.harness` | `studio-config/bin/studio-ship:148,184-232` |
| d3 | **SHIP.md 事故表证明该耦合的历史破坏面**：至少 5 条已固化的排错条目直接由 harness CLI 行为/config.yml 掩盖效应/sync-docs 生成器缺陷引发（2026-08-04 至 08-28 区间）——CLI 行为变化是部署流程的现实破坏源 | `studio-config/SHIP.md:50,81,130,150,151,153,157,160-161` |
| d4 | **`studio-deploy-quick` 同样调用** `npx harness check` + `sync-docs --check --agents`（失败时自动 sync 修复）；**`studio-harness-upgrade`** 串接 npm 镜像同步（npmmirror sync API 轮询）→ pnpm update 全仓 → studio-ship | `studio-config/bin/studio-deploy-quick:104-115`；`studio-config/bin/studio-harness-upgrade:1-50` |
| d5 | **harness 仓发版权归 studio-config 持有**：`harness-ship`（npm version/tag/publish 触发）在 studio-config/bin；`repo-reconcile` 把 harness 纳入 ACTION_REPOS；studio-config 自身 CI `harness-governance.yml` 跑 `npx harness check/passes-gate/sync-docs --check` | `studio-config/bin/harness-ship`；`studio-config/bin/repo-reconcile:25`；`studio-config/.github/workflows/harness-governance.yml:25-31` |

## 附：脱敏说明

本文只写仓内相对路径与 `~/` 级 home 路径；未摘录任何 `.env`/凭证内容，未写内网地址。systemd unit 仅引用环境变量名与公开文档已载事实。
