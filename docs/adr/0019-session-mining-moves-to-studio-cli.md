# ADR-0019: update-user-model / analyze-sessions / session-mining 迁出公开包（架构评审候选3）

- 日期：2026-09-08
- 状态：已接受
- 影响版本：1.6.0（breaking 内容按 minor 号发布，2026-09-09 人类裁决推翻原「下个 major（2.0.0）」）—— 删两个 CLI 命令（breaking，与 ADR-0017/0018 同车）
- 关联：架构评审 2026-09-08 候选3（grilling 决策树已走完）；#110 判例（knowledge upsert/sync-status 迁往 studio CLI）；harness#112（readTranscriptSessions 过滤 seam）、harness#116（路径常量 env 覆盖）；src/CONTEXT.md「公共包，禁止硬编码业务路径」

## 背景

`update-user-model`（476 行）与 `analyze-sessions`（335 行）两个 CLI 命令是个人环境挖掘工具：默认数据源硬编码 `~/.claude/projects/-root--claude`，画像写 `-root-projects/memory/user_profile.md`（update-user-model.ts:63-72，已有 env 覆盖 seam 但默认值不变）。支撑它们的 `src/cli/session-mining/`（transcript/corrections/text，~310 行）仓内消费者只有这两个命令，且全部符号不在包根导出面（src/index.ts 零命中）。

- src/CONTEXT.md 自订「公共包，禁止硬编码业务路径」；#116 集中路径常量只是整理了行李，没有回答「该不该住这」。
- #110 立过同型判例：硬编码 localhost 端点的 knowledge upsert/sync-status 以「不属通用框架定位」迁往 studio CLI，studio 先行封装、harness 净删无残留。
- studio 有真实消费：`monitor-system-probes.ts:214` 以 CLI 字符串跑 `npx harness update-user-model --days 1 --json`，`auditor-rules.ts:63-64` 读其产物 state 文件。

## 决策

1. **整锅迁出**：`update-user-model` + `analyze-sessions` + `session-mining/` 全部迁往 studio CLI。不留 analyze-sessions——它硬编码同一组个人路径，留下等于留同型病灶。
2. **时序按 #110 两步走**：studio 侧先行封装（studio 票：实现 `studio update-user-model` / `studio analyze-sessions`，session-mining 代码随迁，monitor-system-probes 调用点改 studio 自家 CLI）；harness 侧后删。
3. **harness 删除面（净删无残留）**：两个命令文件、`src/cli/session-mining/` 整目录、`definitions.ts` 两条路由（含别名 `uum`/`analyze`）、registry 测试命令清单、`cli/commands/CONTEXT.md` 命令列表、`utils/__tests__/jsonl-skip-disposition.test.ts:45` 对 transcript.ts 的读点冻结条目。breaking 同车发布（级别：2026-09-09 人类裁决按 1.6.0 minor，推翻原 major 判定）。
4. 不留命令名兼容占位（同 #110 净删）。

## 理由

- **公开包的 interface 不为个人工具付供养成本**：个人环境路径、env 覆盖 seam、session-mining 子系统的测试与演进，全部由实际使用它的一侧（studio/个人环境）承担。
- **删除测试通过**：harness 核心（约束/门禁/知识/监控）对这两个命令零引用，迁出后复杂度不搬家，是真实的面收窄。
- **判例一致性**：#110 的理由（硬编码内部端点不属通用框架）与本案（硬编码个人路径）同构，且 #110 的两步时序已验证可行。

## 影响

- 前置：studio 封装票先落地（studio 侧 issue，含 monitor-system-probes 调用点改写与 state 文件路径口径不变）。
- harness：上述删除面；`harness update-user-model` / `harness analyze-sessions` 命令消失（breaking，1.6.0）。
- 文档：`cli/commands/CONTEXT.md`、`CAPABILITIES.md` 命令清单随 sync-docs 更新。
