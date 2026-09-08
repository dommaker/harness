# ADR-0021: git 取证 seam 名义收窄为「check 链路唯一」+ 同型站点收口（架构评审候选5）

- 日期：2026-09-08
- 状态：已接受
- 影响版本：无（内部重构 + 文档口径修正，公开面零变化）
- 关联：架构评审 2026-09-08 候选5（grilling 决策树已走完）；#87（GitEvidence adapter 引入）；候选6/ADR-0022（`checkTestFileChanges` 删除连带消掉一个违例站点）

## 背景

`git-evidence.ts:4` 自称「全仓唯一的 git 取证点」，`core/CONTEXT.md:28` 禁令字面是「core/cli 内不得出现 `execSync('git …')`」。事实核查（候选5 事实包）：**至少 7 个生产文件、约 18 条 git 命令不走 seam**——`knowledge/import.ts`（git log ×2）、`core/validators/passes-gate.ts:414`、`core/spec/validator.ts:297`、`core/session/clean-state.ts`（×4，含 add/commit 写操作）、`core/session/startup.ts`（×2）、`gates/review.ts`（×2）、`cli/commands/release.ts`（×10，经私有 run()）、`cli/commands/review.ts`（×1）。禁令字面只盖 `execSync`，多数违例用 `execAsync`/`execFileAsync`；knowledge 不在字面范围但打脸「全仓唯一」。名义与实况两层皮。

`git-evidence.ts` 内 `GitCommandRunner` 已存在（type alias + `realGitCommandRunner`，:23/:52-55），实例级 memo（含失败缓存）是其真实价值。

## 决策

1. **约定收窄为「check 链路的 git 事实经 adapter」**：`core/CONTEXT.md:28` 与 `git-evidence.ts` 自我声明改写——seam 的适用范围 = context-builder / checker / CheckEnv / validators 这条判定链（一次 run 一份实例、memo 语义所在），不再声称「全仓唯一」。
2. **只收口真同型的两处**：
   - `core/spec/validator.ts:297`（`git diff --cached --name-only`，与 `changedFileNames(staged:true)` 完全同型）→ 改经 GitEvidence；
   - `core/validators/passes-gate.ts:414` → **随 ADR-0022 删除 `checkTestFileChanges` 自然消失**，不在本票动手。
3. **其余站点记名豁免**（写进 `core/CONTEXT.md` 约定段，逐条带理由）：`clean-state.ts`（git add/commit 是**写**操作，不属取证）、`release.ts`（发布流程编排，非判定证据）、`review.ts`×2（PR 审查流，gh/日志语义）、`startup.ts`（会话启动摘要，容忍降级）、`knowledge/import.ts`（导入启发式，失败记 ImportError 降级）。
4. **不选全量收口**（7 文件 18 条命令塞进同一 adapter）：各站点语义异质（写操作/发布编排/审查流/降级容忍各异），硬塞会造出宽 interface；也不选纯文档降级——浪费了真同型站点的收口机会。

## 理由

- **seam 的名义必须等于实况**，否则每次评审都要重新发现一次「两层皮」，且新人会照着错误的名义写代码。
- **一个 adapter 是假想 seam**：check 链路之外的站点没有任何语义跨 git-evidence 变化（它们不要 memo、不要 once 语义、失败处理各异），强行走 adapter 是过设计。
- **收口的收益在判定链内**：memo + 单一证据来源是 check 链路的真实需求（#87），链外站点没有这个问题。

## 影响

- 代码：`core/spec/validator.ts:297` 改经 GitEvidence（构造点沿调用链传入或就地 createGitEvidence，按该文件签名现状最小改动）。
- 文档：`core/CONTEXT.md:28` 禁令改写 + 豁免清单（六站点逐条带理由）；`git-evidence.ts:4,81` 自我声明同步。
- 连带：`passes-gate.ts:414` 站点随 ADR-0022 删除后，豁免清单不收录它。
- 测试：spec/validator 改道后补一枚「git 事实经 adapter」用例（mock GitCommandRunner 而非 child_process）。
