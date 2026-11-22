# ConstraintContext 死字段清理调研（harness#214）

> 调研对象：`@dommaker/harness` master @ `b9012f5`（v4.0.2，CHANGELOG 有 #213 未发布条目）+ `studio` master @ `a6449974`（`@dommaker/harness: ^4.0.2`）
> 方法：三仓（harness/studio/mcp-local-rag）源码静态 grep（区分类型字段 / 生产读取 / 测试夹具 / wire 透传 / sanitize 剥离）+ GitHub code search 外部消费者 + npm registry 版本核对。所有关键结论带 文件路径:行号。
> 范围：纯调研，未改任何公开类型或实现代码，未提交 git。六字段逐项给保留/删除结论；`taskDescription` 与 `operation`/`extraTriggers`/`projectPath`/`changedFiles`/`sessionId` 五个保持不动字段显式确认不在范围。

---

## 一、类型面与公开出口

- 类型正本：`src/types/constraint.ts:166-211`，`ConstraintContext` 共 12 个可选字段（`operation` 必填）+ 2 个必填无（仅 `operation`）。
- 公开出口：`src/index.ts:34-41` 经 `export type` 暴露 `ConstraintContext`；`src/__tests__/public-type-surface.test.ts:145` 的冻结清单钉住符号名（只冻符号不冻字段，删字段无需动冻结清单）。
- 包形态：`package.json:2-21` name `@dommaker/harness`，`main/types = ./dist/index.js|d.ts`，`exports` 只有包根 `.`（4.0.0 已摘除 `./core`/`./presets`/`./gates` 等子路径，CHANGELOG [4.0.0]）。npm latest = 4.0.2（2026-11-18）。
- 历史先例：3.0.0 已删过一批同类型死字段——「`ConstraintContext` 六个从不置位的死字段（hasRootCauseInvestigation 等）+ context-builder 三个探测器」（CHANGELOG [3.0.0] 首条），CAPABILITIES.md:18 记了同一笔。本次六个字段是 3.0.0 清剩下的残余。

## 二、六字段逐项结论

### 判定口径

- **生产读取** = harness src 内（排除 `__tests__`、排除类型声明本身）有 `context.<field>` / 解构消费；
- **生产置位** = harness src 内有构造点写入该字段；
- **wire** = 经 HTTP/MCP 边界传输的数据（studio 侧）。

### 逐项表

| 字段 | harness 生产读取 | harness 生产置位 | 测试夹具 | studio 使用 | 结论 |
|---|---|---|---|---|---|
| `workflowId` | 无（仅 `src/types/constraint.ts:179` 声明） | 无 | 无 | 无 | **删除** |
| `stepId` | 无（仅 `src/types/constraint.ts:182` 声明） | 无 | 无 | 无 | **删除** |
| `commitMessage` | 无（仅 `src/types/constraint.ts:197` 声明） | 无 | 无 | 无（contract schema 未声明，zod 默认剥未知键） | **删除** |
| `branch` | 无（`src/types/constraint.ts:200` 之外的 `branch` 命中全是 CLI option/无关变量） | 无 | 无 | 无 | **删除** |
| `worktreePath` | 无（仅 `src/types/constraint.ts:210` 声明） | 无 | 无 | studio 的 `worktreePath` 命中（`apps/web/.../WuGateActions.tsx:44-45`、`packages/studio-agent/.../worktree-exclude.test.ts:93`、`workunit/merge-on-review-pass.ts:434`）全是 workunit 元数据/merge 流程，与 ConstraintContext 无关 | **删除** |
| `hasPlanApproval` | 无（仅 `src/types/constraint.ts:207` 声明）；3.0.0 出清证据标志管道后该字段无置位来源、无 checker 消费 | 无 | 无 | studio `sanitize-context.ts:21` 的 `EVIDENCE_FLAGS` 剥离清单含它（wire 卫生面，防旧客户端自报）；`safety.tools.test.ts:91`、`sanitize-context.test.ts:16` 为剥离测试 | **删除**（harness 侧），studio 剥离清单**保留不动**（见 §五） |

证据要点：

- harness 全 src grep `workflowId|stepId|commitMessage|worktreePath|hasPlanApproval`（排除测试）零命中类型声明以外的位置；checker 链实际消费的 context 字段只有 `operation`/`extraTriggers`/`projectPath`/`changedFiles`/`sessionId`：`src/core/constraints/checker.ts:148-150`（trace 记录）、`checker.ts:188/226/291/305`、`src/core/constraints/checkers/types.ts:87`、`checkers/no-completion-without-verification.ts:93`、`checkers/no-hardcoded-credentials.ts:172`；`src/core/command-execution-policy.ts:137-154`（`planCommandsFromConstraints`）只读 `operation`+`extraTriggers`。
- 生产 context 构造点只有两个，均不置位六个候选字段：`src/core/constraints/context-builder.ts:113-118`（只产 `operation`/`extraTriggers`/`projectPath`/`changedFiles`）、`src/cli/commands/report.ts:80-82`（`operation`+`projectPath`）。
- 全量 `context.<field>` 属性访问扫描（`src/**/*.ts` 排除测试）无一对六个候选字段的访问。
- studio 两条 wire 入口都不传六个字段：`constraints.routes.ts:297-302`（只传 `operation`/`taskDescription`/`projectPath`/`hasRequirement`）、`mcp/safety.tools.ts:34`（`{ ...input.context, operation }`，MCP 入参 schema 未声明六字段）；wire 契约 `packages/studio-contract/src/harness.ts:237-242` 只声明 `operation`/`taskDescription`/`projectPath`/`hasRequirement`。
- issue 断言「`hasPlanApproval` 来源的程序执法从未落地」复核成立：harness/studio 生产代码无任何置位点；studio 侧它只存在于「剥离清单 + 剥离测试」，即专门防止旧客户端自报的防御面。

### 显式确认不在删除范围

- `taskDescription`：harness 生产无读取（仅测试夹具 `core/constraints/__tests__/collect-constraints.test.ts:39,45`），但 studio wire 契约声明并透传它（`studio-contract/src/harness.ts:239`、`constraints.routes.ts:299`），issue 也点名保留——**保留**。
- `operation` / `extraTriggers`：checker 分发与命令清单的主口径（`checker.ts:226/305`、`command-execution-policy.ts:142`）——**保留**。
- `projectPath`：checker/gates 主取数锚点（`checker.ts:188/291`、`checkers/types.ts:87`、gates 多处）——**保留**。
- `changedFiles`：多个 checker 的判定输入（`no-completion-without-verification.ts:93`、`no-hardcoded-credentials.ts:172`）——**保留**。
- `sessionId`：trace 记录读取（`checker.ts:150`）——**保留**。

## 三、外部消费者核查（局限已登记）

- GitHub code search `"@dommaker/harness"`（2 页 ×100 条全量）只命中 `dommaker/harness` 自身——未发现任何公开 GitHub 仓编程消费 `@dommaker/harness`。
- GitHub code search `hasPlanApproval` 的命中全部是无关仓库的自有同名字段，无一引用本包。
- mcp-local-rag 对 harness 零依赖（源码/skills grep 零命中）。
- **局限**：① 私有仓/未 push 到 GitHub 的 npm 消费者无法穷举；② GitHub code search 不索引编译产物，经 `dist` 深层路径的引用可能漏网（但 4.0.0 已声明子路径出口全摘、公共面只剩包根）；③ studio-prod 是 studio 的部署 checkout，消费面 = studio 本身，无独立 harness 引用。结论可信度受限于「消费方仅 studio」这一既有治理假设（ADR-0029/0041 一直按此口径执行删除）。

## 四、版本与 changelog 惯例

- 当前版本 4.0.2，CHANGELOG [Unreleased] 已有 #213 条目；breaking 惯例 = conventional commits `refactor!:` / `refactor(public-api)!:` + Keep a Changelog，major 号发布，changelog 条目内写迁移说明（3.0.0/4.0.0 大条目均含「迁移：」段）。
- deprecated 先例与态度：仓内 `@deprecated` JSDoc 只在「在途消费者编译兼容」时用（CHANGELOG [1.x] `TIPS` 条目）；ADR-0004/0005 明确「deprecated 标在无人 import 的模块上是形式主义」「生产断链 + 零消费方，直接删优于 deprecated 形式主义」；ADR-0029「breaking change，无 deprecation 过渡期——消费方仅 studio，双仓同批改」。3.0.0 删同族六个死字段就是直接删、无 shim。
- 发布通道：tag 触发 npm 发布（harness-ship，不本地 publish）。

## 五、studio sanitize-context 随动分析

- 位置：`apps/api/src/modules/harness/sanitize-context.ts`。`EVIDENCE_FLAGS`（:19-30）是字符串字面量清单 + 对 `Record<string, unknown>` 的运行时删除，**不依赖 harness 类型字段存在**；`hasPlanApproval` 从 harness 类型删除后 studio 编译不受影响（`sanitizeConstraintContext` 入参是 `ConstraintContext | Record<string,unknown>`，:43）。
- 因此 harness 删字段**不强制** studio 同批改。最小随动 = 无；可选随动 = 等确认无旧客户端自报 `hasPlanApproval` 流量后，从 `EVIDENCE_FLAGS` 移除该项并删 `sanitize-context.test.ts` 对应断言（文件 :16/:26），独立小票处理，勿与本票捆绑。
- studio-shared 只是类型透传（`packages/studio-shared/src/index.ts:38`、`src/node.ts:20`），可选字段删除对透传无影响；其 `dist/*.d.ts` 为构建产物随 `pnpm build` 再生。

## 六、推荐方案

**六字段全部删除，下个 major（5.0.0）直接删，不走 deprecated 过渡。**

依据：生产置位/读取双零、唯一已知消费方 studio 不构造不传、外部公开消费者为零、3.0.0 同族先例与 ADR-0004/0005/0029 的「零消费直接删」口径。deprecated shim 在类型可选字段上没有编译期信号价值（消费方不引用即无感知），只剩形式主义。

### 最小实施票范围（harness 单票 + studio 可选随动票）

1. harness 票：`src/types/constraint.ts` 删六个字段声明（:179/:182/:197/:200/:207/:210）及其 JSDoc；CHANGELOG [Unreleased] 加 `refactor!:` 条目（点明 5.0.0 breaking、迁移说明「六字段自 3.0.0 起已无任何置位来源与 checker 消费，构造/透传方删键即可，无行为变化」）；核对 `CAPABILITIES.md:18`、`docs/public-exports-review.md:23`、`src/core/CONTEXT.md` 是否提到具体字段名（`ConstraintContext` 符号名不变，公共面冻结测试无需改）。预计 diff < 20 行，无需新测试（纯类型字段删除；若治理要求「新文件零测试不可提交」针对的是新代码，本票无新文件）。
2. studio 可选票（独立）：确认无旧客户端自报流量后从 `EVIDENCE_FLAGS` 移除 `hasPlanApproval`，更新 `sanitize-context.ts` 头注释（:10-15 说「ConstraintContext 类型面只剩 hasPlanApproval」的表述随动）。

### 跨仓验证顺序与命令（均取自各仓 package.json scripts）

1. harness 仓内：`npm run build`（= `tsc`，类型闸）→ `npm test`（jest 全量）→ `npm run lint`（`eslint src`）。
2. studio 升 `@dommaker/harness` 依赖后：`pnpm typecheck`（根 `bin/tsc-gate.js --check`）→ `pnpm test`（vitest run；重点 `apps/api` 的 `modules/harness/__tests__/sanitize-context.test.ts`、`modules/mcp/__tests__/safety.tools.test.ts`、`tests/harness-integration.test.ts`）→ `pnpm build`（`pnpm -r build`）。
3. 回归闸：harness `src/__tests__/public-type-surface.test.ts`（符号冻结，应无变化）、studio contract 测试 `packages/studio-contract/src/__tests__/harness.test.ts`（wire schema 未动，应无变化）。

### 回滚方案

- 删除仅触及类型声明面（六字段无任何生产读写路径），回滚 = revert 单 commit + `npm run build && npm test` 复绿；若 5.0.0 已发布后发现未知消费者，补丁路径 = 5.0.1 恢复字段声明（字段为可选，恢复无行为面）。
- studio 侧无随动改动时，回滚 harness 单独完成即可，studio 无需动。

## 七、未决风险

1. 私有/不可见消费者无法穷举（§三局限）——发布前可在 5.0.0 changelog 迁移段把六字段点名，给潜在消费者最后一次显式信号；这是低成本兜底，不改变「直接删」结论。
2. studio `EVIDENCE_FLAGS` 对旧客户端自报 `hasPlanApproval` 的剥离是**有意保留的防御**（sanitize-context.ts:14-15 明言「保留至确认无旧客户端流量后另行退役」）——本票删除 harness 类型字段与该防御不冲突，但「旧客户端流量是否已清零」本身无数据支撑，属独立未决项。
3. `sessionId` 本次保留，但注意 harness 生产同样无任何置位点（只有 trace 读取 `checker.ts:150`），它可能是下一轮清理的候选——本票不动，仅登记。
