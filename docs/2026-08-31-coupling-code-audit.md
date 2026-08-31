# harness↔studio 双向代码面耦合复查（wayfinder #73）

> 日期：2026-08-31
> 范围：对照基线 `docs/2026-08-15-studio-harness-boundary.md`（#28）+ #31 裁决 + studio #150（A1-A5/B1-B3，2026-08-16 落地）全量重扫。检索口径三重：静态 import grep + 动态 require（`harnessModule!.X`）+ `require.resolve`/字符串深路径 + 机器配置（`.claude`/`.codex`/`.kimi-code`）。
> 结论导向：只盘点分类（回潮/新增/已清），去向裁决归 #75 grilling 票。每条带 `文件路径:行号` 证据。
> 仓库基线：harness @ `7f811a4`（v1.2.3）；studio @ 本地 master `f86fb4f5`（2026-08-31）。studio 扫描排除 node_modules/dist/studio-prod。

---

## 0. 结论摘要

| 分类 | 条数 | 内容 |
|------|------|------|
| 已清 | **7** | #150 落地项全部验证为真：provider-hooks dist 深路径、rule-scanner src 硬编码、facade 删薄、采样缓存、prompt 渲染回收、hook 配置归一、estimateTokens |
| 回潮 | **2** | 均在机器配置面：`.claude/settings.json` 旧式 dist 深路径未迁移 shim；`.codex`/`.kimi-code` shim 路径钉死 studio-prod pnpm @1.1.1 旧版本 |
| 新增 | **5** | studio 侧类型镜像 1 条；harness 侧 studio 概念渗入 2 条（WU 词表、`.studio/` 布局）；基线漏项首记 2 条（devops criticalFiles、harness `~/.studio` 默认路径） |
| 观察（不计入） | 4 | provider-usage.ts 住 harness/ 目录但零耦合；hooks-closure-check 健康新消费；generator.ts 挂起等 harness 未导出能力；#31 裁决留 studio 项维持原状 |

核心判断：**#150 的代码面清耦全部真实落地，无一项回潮到源码层**；残留全部集中在**机器配置面**（`.claude/settings.json` 是 #32 教训的再次应验——单扫源码会漏报）。反方向上，#160/#188 两票（均在基线次日 2026-08-16 落地）把 WU 编排词表和 `.studio/` 数据布局写进了 harness 源码，这是基线时没有的**新增反向渗入**，是否越界留给 #75 裁决。

---

## 1. 已清（#150 落地验证，7 条）

| # | 基线条目 | 现状证据 | 验证 |
|---|----------|----------|------|
| E1 | `provider-hooks.ts` 经 `require.resolve` 定位 `dist/gates/command.js`（基线 §7.3 脆弱耦合） | 深路径已删。现 `resolvePreToolUseHookPath()` 走 `require.resolve('@dommaker/harness')` 根导出 → 包出厂 shim `dist/pretool-use-hook.js`（`studio/packages/studio-agent/src/services/provider-hooks.ts:24-28`）；harness 侧 shim 源码 `harness/src/pretool-use-hook.ts`（2026-08-16，studio #153，commit `4f39f02`）。全仓 grep 确认 `dist/gates/command` 在 studio 源码零残留 | ✅ #154/#189 |
| E2 | `rule-scanner.ts` 硬编码 `node_modules/@dommaker/harness/src/core/constraints/definitions/` 源路径 | 改走公共 API `getEffectiveConstraints(PROJECT_ROOT)`，注释自述 #150 B2（`studio/apps/api/src/modules/knowledge/rule-scanner.ts:198-215`，import 在 :8） | ✅ #150 B2 |
| E3 | `studio-shared/src/harness/index.ts` 270 行纯透传 facade（基线 §7.2 建议删薄） | 删薄至 27 行，`ConstraintService`/`CheckpointService`/`SafetyService` 全退役，只留 studio 自有模块导出（`studio/packages/studio-shared/src/harness/index.ts:1-27`） | ✅ #150 A5 |
| E4 | `runtime/cache.ts` 采样缓存（基线 B#1，唯一收编候选） | 文件已删（`runtime/` 仅剩 `bootstrap.ts`）。`goal.hooks.ts:16` 直用 harness `CheckCache` + `{ sampleRate: 3, defaultValueOnMiss: true }`（`studio/packages/studio-shared/src/harness/hooks/goal.hooks.ts:7,16,21-33`）；harness 侧计数采样已上收 `harness/src/core/constraints/check-cache.ts:47,85`（2026-08-15 H6 后半，#45） | ✅ #150 A1 |
| E5 | `prompt-injection.ts` 手写过滤/分组/渲染（基线 C#3） | 删薄至 39 行纯 role→trigger 路由，渲染回收 harness `renderConstraintsByTrigger`（`studio/packages/studio-shared/src/harness/prompt-injection.ts:11,35-38`）；harness 侧 `harness/src/core/constraints/agent-prompt-renderer.ts`（G6，#45），导出于 `harness/src/index.ts:74` | ✅ #150 A3 |
| E6 | `hooks/config.ts` per-hook 配置双轨（基线 C#4） | 归一为 harness 形状 `{name,enabled,errorStrategy}`，`blocking` 仅作声明表内映射源经 harness `toErrorStrategy` 无损映射（`studio/packages/studio-shared/src/harness/hooks/config.ts:15-16,45-52`）；`safeCallHook` 由 `runHook` 接替（:65-78）。`HARNESS_HOOK_DISABLE` env 开关按裁决保留（:39-42） | ✅ #150 A4 |
| E7 | `session-metrics.ts` 的 `estimateTokens`（基线 B#2，studio 重复造） | 已删，全仓 grep 零残留；消费方 `knowledge-service.ts:37` 改用 harness `TokenEstimator`（`studio/apps/api/src/modules/knowledge/knowledge-service.ts:37`；另 `prompt-composer.ts:20`、`agent-loop.ts:11` 同） | ✅ #150 B 系 |

---

## 2. 回潮（2 条，均在机器配置面）

| # | 现象 | 证据 | 说明 |
|---|------|------|------|
| R1 | studio 仓 `.claude/settings.json` 仍是**旧式 dist 深路径**，且指向 harness **仓 checkout** 而非 node_modules | `studio/.claude/settings.json:32` `require('/root/projects/harness/dist/gates/command')`；`:64` `require('/root/projects/harness/dist/core/constraints/checker')` | #147/#154 已确立「出厂 shim + require.resolve 根导出」模式，provider 生成面（`.codex`/`.kimi-code`）已迁移，唯独手写/留存的 `.claude/settings.json` 未迁移。harness 内部文件移动即断；且依赖 `/root/projects/harness` 本地 checkout 存在，部署形态脆弱 |
| R2 | `.codex/hooks.json` / `.kimi-code/config.toml` 的 shim 路径**钉死 studio-prod pnpm 版本深路径** | `studio/.codex/hooks.json:10` 与 `studio/.kimi-code/config.toml:80`：`node /root/projects/studio-prod/node_modules/.pnpm/@dommaker+harness@1.1.1/node_modules/@dommaker/harness/dist/pretool-use-hook.js` | 路径本身是新 shim（#154 模式正确），但钉在 `@1.1.1`——studio `package.json:65` 已要求 `^1.2.3`，机器配置与依赖声明脱节两个 minor；pnpm 版本化路径在 harness 升级后指向旧包甚至失效路径。另注：该绝对路径含 `studio-prod` 部署布局，写在公开仓配置里（脱敏问题超出本票范围，仅记录） |

---

## 3. 新增（5 条）

| # | 方向 | 现象 | 证据 | 说明 |
|---|------|------|------|------|
| N1 | studio→harness | `completion-gates.ts` **手工镜像 harness 类型** + 运行时特征检测 | `studio/apps/api/src/modules/agents/loop/completion-gates.ts:107-178`（`SoftCheckCommitInput`/`SoftCheckVerdict`/`CompletionCheckersConfig`/`CompletionCheckerFns` 全套镜像）；动态消费在 `:182-195`（`harnessModule as Partial<CompletionCheckerFns>`，函数缺席即整体跳过） | T7-E2（#161）落地时 harness 未发版，注释称「npm @dommaker/harness 0.19.0 尚无这些导出」（:107-108）。但 harness 现已 1.2.3 且三纯函数已公开导出（`harness/src/index.ts:346-370`，`verifyTddChain`/`verifyPhaseFormat`/`verifyContractPresence`），studio `package.json` 已 `^1.2.3`——镜像与特征检测的存续理由已消失，版本注释口径过时 |
| N2 | harness→studio | **WU 编排词表进 harness 源码** | `harness/src/completion-checkers/`（2026-08-16，studio #160，commit `38a04a6`）：`index.ts:4`「WU 收尾软观测三件套」、`types.ts:9`「WU 提交输入」、`tdd-chain.ts:6,47`「本 WU 提交集」、`phase-format.ts:2,35`；`harness/src/index.ts:343`「WU 收尾软观测三纯判定函数」 | WU（WorkUnit）是 studio PMO 编排概念（基线 §7.6 分类基准里「goal/step/WU 编排」明确属 studio 侧）。函数本身是纯判定（git 提交集 → verdict），但词表与文档字符串整体采用 studio 编排语义。基线时此目录不存在，属基线后新增反向渗入 |
| N3 | harness→studio | **`.studio/` 数据布局进 harness sync-docs 代码** | `harness/src/cli/commands/sync-docs/agents-syncer.ts:132` 注释「正本模型（studio #152/T12）」、`:134` 生成行「模块上下文正本：`.studio/CONTEXT.md`」、`:258-264` `hasStudioContextModel()` 探测 `.studio/CONTEXT.md` 存在性（2026-08-16，studio #188，commit `ed786e8`） | harness 通用 CLI（sync-docs）硬编码 studio 专属的 `.studio/` 目录约定与「正本模型」概念，注释直接引用 studio 票号。基线时无此逻辑，属基线后新增反向渗入 |
| N4 | studio→harness | `devops.tools.ts` **criticalFiles 硬编码 harness dist 内部文件清单**（基线漏项首记） | `studio/apps/api/src/modules/mcp/devops.tools.ts:77`：`['dist/core/constraints/checker.js', 'dist/knowledge/doctor.js', 'dist/index.js']` | `publishPackage` 工具签名是通用的（`packagePath` 入参），但 dist 完整性校验清单写死 harness 内部布局——harness 目录重构即误判（已有前科：commit `6cf3c329`「适配 harness 0.16.7 重构——devops criticalFiles 换 checker.js」）。2026-05-23 即有（`2c01508f`），早于基线；基线只扫 import/require 未扫字符串深路径，本次首记 |
| N5 | harness→studio | **`~/.studio` 默认路径散落在 harness 知识 CLI**（基线漏项首记，反向既有） | `harness/src/cli/commands/knowledge.ts:505` `getKnowledgeDir()` 缺省返回 `~/.studio/knowledge`（2026-05 即有）；`harness/src/knowledge/index-generator.ts:62` 生成的索引头写 `~/.studio/knowledge/_index.md`；`harness/src/cli/commands/definitions.ts:254` 知识来源选项含 `(analyst/cli/design)`（analyst 角色词，轻微） | 均为基线前既有（2026-05/07），基线未扫反向故首记。harness 作为通用框架把 studio 的数据区路径当缺省值 |

---

## 4. 观察项（不计入分类，供 #75 参考）

1. **`provider-usage.ts` 住进 harness/ 目录但零 harness 耦合**（`studio/packages/studio-shared/src/harness/provider-usage.ts`，136 行，2026-08-18 #134）：import 仅 `./session-metrics` 与 `../llm/stream-json-parser`，是 provider usage 解析业务模块。不是透传层回潮，但住在 `harness/` 目录易误导后续盘点。
2. **`scripts/tools/hooks-closure-check.ts:14`**（2026-08-16，#150 C1/#202）：新增消费 `assertHookRegistryClosed`，公共 API 正当消费，健康。
3. **`evolution/generator.ts:67-75`**：`constraintProposals()` 挂起返回 `[]`，注释自述等待 harness `dist/core/constraints/usage-report` 的 `buildConstraintsUsageReport`/`diagnoseRetireCandidates` 公开导出——是对 harness 未公开能力的期待，当前无实际耦合。
4. **#31 裁决留 studio 项维持原状**：`hooks/audit.ts` 决策台账仍带 `eventBus.publish('events:audit')`（`studio/packages/studio-shared/src/harness/hooks/audit.ts:12,58`）；HTTP TTL 缓存仍在（`studio/apps/api/src/modules/harness/runtime.ts:44-54`）。与裁决一致，无漂移。
5. **harness `docs/` 内大量 studio 引用**（转型规划、研究文档、本基线文档）：历史文档，良性，不计渗入。
6. **harness 出厂 `pretool-use-hook.ts`**（#153/#154）：是清耦的使能项而非渗入——harness 为 provider PreToolUse 场景出厂通用 shim，属既定边界决策。

---

## 5. 动态消费面复核（防 #32 漏报）

`apps/api/src/modules/harness/` 的 `harnessModule!.X` 动态消费（`runtime.ts:23-30` 活绑定 + `diagnostics.routes.ts:61`、`knowledge.routes.ts:151-152`、`sessions.routes.ts:33,67`、`constraints.routes.ts:66,91,156,214,239`、`cso.routes.ts:23`、`agents.routes.ts:31`、`completion-gates.ts:182`）：子路由 2026-07-19 拆分起即存在（commit `d39de277`），基线 §1.1 注已通过测试 mock 面覆盖记录，**非新增**。全部经 `typeof import('@dommaker/harness')` 公共导出面，无深路径。

`require.resolve` 全仓仅两处：`provider-hooks.ts:26`（根导出 → 出厂 shim，✅ E1）与 `worktree-resolver.ts:198`（`@dommaker/harness/package.json` 定位 `templates/node-api`，与基线 §3 一致，模板路径约定未变）。

---

## 6. 统计对照

| 维度 | 基线（2026-08-15） | 本次（2026-08-31） |
|------|--------------------|--------------------|
| 包装层规模（`studio-shared/src/harness/**`，含测试） | 16 文件 1432 行 | 15 文件 1227 行（删 cache.ts；facade 270→27、prompt-injection 71→39、config 80→78；新增 provider-usage 136） |
| studio 源码 dist 深路径 | 1（provider-hooks → gates/command.js） | **0**（机器配置面另有 2+2 处，见 R1/R2/N4） |
| harness 源码含 studio 概念 | 0（未扫反向；既有 `~/.studio` 缺省 3 处本次首记） | 既有 3 处（N5）+ 新增 2 处（N2/N3） |
| 回收候选 B/C 项 | B=2，C=4 | B 全清（E4/E7）；C#3/C#4 清（E5/E6），C#5/C#6 按裁决留 studio 维持 |
