# ADR-0023: CheckEnv 提为一次 check 的运行级只读快照——同一次运行内每个项目文件至多读一次（架构评审 2026-09-14 候选2）

- 日期：2026-09-14
- 状态：已接受（当人面确认，2026-09-14）
- 影响版本：实面无 breaking 则为 patch/minor；若步骤 3/4 落地时触及 `ConstraintContext` 或 `CheckCache` 的公开形状，按 ADR-0003/0022 口径改判为 breaking 随下一版本发布，studio 同批适配（不排兼容性期）。
- 关联：架构评审 2026-09-14 候选2（grilling 决策树已走完）；ADR-0021 / #87（一次 run 一份 git 证据，本 ADR 把同一形状复制到上行数据面）；ADR-0016（判定证据面，本 ADR 顺带补齐两个漏迁 checker）；ADR-0009（`reconcileCapabilities` 判定单一来源，本 ADR 只动取证不动判定）；工单 16（`rawConfigCache` 进程级 memo 的出处，本 ADR 撤销它）；`jsonl-skip-disposition.test.ts`（harness#100 站点冻结闸，本 ADR 必然改动它）

## 背景

用只插桩不改文件的 fs 计数脚本实测（monkeypatch `fs` 后直接 require `dist/cli/commands/check.js`，目标 `/root/projects/studio` 与 `/root/projects/harness`，写操作换 no-op）：

| 重复项 | 一次 `harness check` 实际次数 | 实测成本 |
|---|---|---|
| `traces.log` 全量读 | **3×**（`check.ts:232` 数行数 + `context-builder.ts:97` tail:20 + `:137` tail:10，后两者在 `buildConstraintContext:213/215` 无条件并列） | studio 6.7MB 单次 **16.6–21.1ms** → 合计 **51–63ms** |
| `detectSourceRoots` | 默认 **2×**、pre-commit 带源码改动 **3×**（`context-builder.ts:65`、`docs-freshness.ts:45`、`capability-sync.ts:57`；`doc-freshness/runner.ts:318` 在当前任何真实配置下 **0 次**） | studio 每次 51 `readdirSync` + 22 `existsSync` ≈ **3.7ms** |
| `reconcileCapabilities` | `module_*` 触发时 **2×**，两边解析输入逐字节相同（同 content / populationFiles / sourceRoots） | 带 `fileExists` 版 7.6ms + 202 `existsSync`；不带版 15.9ms 纯 CPU |
| `.harness/config.yml` | 内容 1×（有 memo），但为判指纹做 `statSync` **5–7×** | 亚毫秒级 |
| `custom-constraints.yml` | **2× 读 + 2× `yaml.load`**（`:171-181` 无 memo）——因一次 check 走两遍生效约束集链路（`check.ts:87` 与 `check.ts:186`→`injection-drift.ts:120`） | 6.1KB，亚毫秒级 |
| `CLAUDE.md` / `AGENTS.md` | studio 2×、harness 3× | 1.5–25KB，<1ms，**本 ADR 不处理** |

一次 check 总 fs 操作数：studio 干净树 **595**、pre-commit 带源码改动 **≈650–700**。整条命令墙钟 110ms（harness）/ 180ms（studio），即重复读占 **三分之一到二分之一**，且 `traces.log` 是 append-only 无上限文件，成本随历史线性增长。

两处名义与实面相反，是本轮定性的依据：

1. `CheckEnv`（`checkers/types.ts:16-27`）自称「单次 run 内共享的上下文与 memoized I/O」，实面只提供 `stagedDiff` / `stagedDiffNames` / `srcScan` 三件，项目文件读取全部由各 checker 裸调 `fs`——承诺与供给脱节。
2. `utils/jsonl.ts:14-15` 与 `:126-127` 断言「文件仍全量读取，parse 才是大头」「10MB 级文本读廉价」。实测相反：`countJsonlLines` **完全不 parse**，单次仍 16.6–21.1ms，成本在 `split('\n')` + `filter` 三万多行上。

## 决策

1. **`CheckEnv` 提到最外层，成为一次 check 运行的统一环境对象**，在 CLI 入口构造，向下供 context-builder、checker、CLI 侧消费点共用。不新立第二个同类概念（否：外层另造 `RunSnapshot` + `CheckEnv` 派生 = 两个名字指近同一件事）；不挂进 `ConstraintContext`（否：它是「本次为何触发」的数据描述，且 context-builder 是它的构造者，挂活把手会形成「自己造的对象带着自己读文件要用的把手」的构造顺序死结）。
2. **一切「一次运行一份、运行结束即弃」**。撤销 `project-config-loader.ts:37-73` 的进程级 `rawConfigCache` 与 mtime+size 指纹——它靠秒/毫秒级时间戳判新鲜，同一次运行内「先改后读」照样读到老内容，是在新快照旁边再养一套口径。删除后 config.yml 与 custom-constraints.yml 各在运行开始读一次，连带消掉「生效约束集算两遍」与 5–7 次判指纹 `statSync`。
3. **`readJsonl` 两端读取都改为分块有界读**：tail 从文件末尾倒着分块 seek、head 从文件头正着分块读到够数即停，都不再整读再切。语义逐字不变：行以 `\n` 界定、末行允许无换行、`\r` 随行进文本、纯空白行不计数、窗口内坏行照旧计入 `skippedLines`（坏行占槽位不占 records 名额）。
   - 第三处全量读（`check` 智能提示）另治：它的真实需求是「累计条数够不够 50」这一**阈值判定**，总数从不打印，故改经有界 `head: 50` 读，以 `records.length + skippedLines` 作与原纯计数逐字等价的判定输入。纯计数入口 `countJsonlLines`（把坏行算进条数却不 parse）随之失去唯一生产消费者，按 ADR-0022 同判据删除，不留兼容壳。
   - `readJsonlEnds` 要的是全文行数（首末记录 + `totalLines`），保持整读路径不动。
4. **环境对象上加 `traceLog()`（一次倒读同时供「最近有无 fail」「最近有无 pass」两个布尔证据，把 `context-builder.ts:97`/`:137` 两处并列尾部读并成一次）、`sourceRoots()`、`capabilities()`（一次解析多消费）**。不给 `lineCount`：需要总数的消费方已在决策 3 改为阈值判定，为它保留一次全文读是凭空造需求。
5. **验收两道，都是硬门槛**：① 计数假读盘件断言「一次运行内每个项目文件至多读一次」，形状照 `check.test.ts:78-106` 的 `recordingEvidence()`（真执行 + 只记命令串 + `new Set(commands).size === commands.length`）；② 固定项目跑 check，改前改后 stdout 与 trace 逐字节对比，证明判定一字未变。
6. **范围外，各自另立**：`traces.log` 轮转/上限（改变「历史上有多少 trace 可读」，是数据保留取舍，仓内已有按大小 rename 先例 `monitoring/context-tracker.ts:33,127`）；治理正本落点口径不一致（`governance-presence.ts:47-48` AGENTS 优先 / `injection-writer.ts:37`+`injection-drift.ts:89` CLAUDE 优先 / `context-builder.ts:151` 只看 CLAUDE 无回落——正确性问题，与本 ADR 的性能轴无关）；`DEFAULT_TRACE_FILE` 相对路径致 trace 落到 CWD 而非 `--project-path`（违反 harness#95 约定，缺陷票）。

## 理由

- 收益归因要诚实，避免后续按 50–70ms 双倍期待：决策 3 落地后 `traces.log` 的**三处全文读已全部消失**（两处尾部读变分块 seek、第三处经实面核查本就是阈值判定，不该数全文），故决策 4 的 `traceLog()` 在这一点上**已无余量可拿**，只剩把并列的两处尾部读并成一次的可维护性收益；步骤 2–4 的净收益因此主要落在源根探测（7–11ms）、reconcile 共享解析（8–16ms）与配置装载（消除 2× 生效集链路）。
- 决策 1 选 (c) 而非 (a)：`CheckEnv` 的名义已经是正确答案，问题只是它被放在了 checker 层，而三处重复读有两处（context-builder、CLI 数行数）根本不在那一层。承认并抬举既有概念，比再造一个更不容易留下两套口径。
- 决策 2 撤销进程级缓存是本 ADR 唯一带删改既有裁决的部分（工单 16）。当初加它正是为了躲测试同进程反复改文件；运行级快照出现后，那个理由由「快照跑完即弃」直接满足，指纹机制失去存在依据。

## 影响

- 代码：`utils/jsonl.ts`（tail 倒读 + head 正读双向有界分块、删 `countJsonlLines`、两处反向 docstring 改写）**已落**；`cli/commands/check.ts` 的 `getSmartHint` 改阈值读 **已落**；待做：`core/constraints/checkers/types.ts`（`CheckEnv`/`EvidenceProviders` 扩访问器，`'none'` 字面返回同步补形）、`cli/commands/check.ts`（入口构造环境对象，:186 漂移检测改消费它）、`core/constraints/context-builder.ts`（:65/:97/:137/:153 改经环境对象，签名新增入参）、`core/constraints/checkers/{capability-sync,docs-freshness,governance-presence}.ts`、`core/project-config-loader.ts`（删 `rawConfigCache`）、`gates/checker-gate.ts:32`（随 `buildCheckEnv` 形状调整）。
- 测试（已落部分逐条记账）：`jsonl.test.ts` 补 tail 语义等价六组（含 CJK 跨块边界、末行无换行、CRLF、尾部空白行、`tail:0`/缺文件）；新增 `jsonl-bounded-read.test.ts` 作「有界读不整读全文」反证闸（模块层把 `readFileSync` 换成必炸 + 一条「全文读确实必炸」的自我检查）；`jsonl-skip-disposition.test.ts` 冻结表**新增站点 `src/cli/commands/check.ts: 1`**（智能提示由纯计数改为 skip 策略的 head 读，成为本契约第 9 个 skip 站点，去向豁免写在调用点注释），文件头关于 `countJsonlLines` 不在表内的说明随之改写；`jsonl.test.ts` 中 `countJsonlLines` 的专用 describe 随入口删除，`appendJsonl` 用例里借它做的断言改经存活的 `readJsonl` 表达同一事实（未弱化）；`monitoring/__tests__/context-tracker.test.ts` 的 `fs` 假件原先只覆盖 `readFileSync`，补 `openSync`/`fstatSync`/`readSync`/`closeSync` 并与 `readFileSync` 同源后其 5 条 tail 用例恢复，**断言一字未改**。待做：`check.test.ts` 的 git 计数闸扩为文件读计数闸（基线：studio 干净树 595 次 fs 操作、pre-commit ≈650–700）。
- 文档：`src/CONTEXT.md` 术语表加「运行级环境（run environment）」条目并写明其唯一正本落点；`src/core/CONTEXT.md` 的 `CheckEnv` 描述由「checker 的环境」改写为「一次 check 的统一环境，入口构造」；`utils/jsonl.ts` 头部关于「全量读取廉价」的断言按实测改写。
- 交付顺序按步独立提交，每步有可回滚 checkpoint：步骤1 jsonl → 步骤2 环境对象提到入口 → 步骤3 配置一次装载 → 步骤4 源根/reconcile 共享 → 步骤5 计数与等值验收（计数测试随各步同 commit，不单独攒）。
