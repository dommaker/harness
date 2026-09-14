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

1. **一次 check 的运行级观察面在 CLI 入口构造、显式向下传**。原决策写作「只把 `CheckEnv` 提到最外层、不新立第二个概念」，**动手时被证伪并已更正**：`CheckEnv` 含 `context`，而 `context` 正是 context-builder **通过这个观察面读文件算出来的产物**——同一对象不能既是构造者的输入又是其产物（构造顺序死结，恰是当初否掉「挂进 `ConstraintContext`」的同一条理由）。实面形状：
   - `RunEnv`（`core/constraints/run-env.ts`）= 不需要 context 就能造的那半：`projectPath` + `traceTail(limit)` + `sourceRoots()`，CLI 入口造、按需向下传；
   - `CheckEnv`（checker 面，名字与 12 个 checker 的现状不动）= `RunEnv` + `context` + git/扫描 providers，从前者派生。
   两个**类型**、一份实现、一条读路径；新增的是一个约 30 行的类型与工厂，不是第二套取数逻辑。2b 有意**尚未**把 `RunEnv` 接进 `CheckEnv`——当时无任何 checker 消费它，先接就是为将来预先改签名（该接线属步骤 4）。
2. **一切「一次运行一份、运行结束即弃」**。撤销 `project-config-loader.ts:37-73` 的进程级 `rawConfigCache` 与 mtime+size 指纹——它靠秒/毫秒级时间戳判新鲜，同一次运行内「先改后读」照样读到老内容，是在新快照旁边再养一套口径。删除后 config.yml 与 custom-constraints.yml 各在运行开始读一次，连带消掉「生效约束集算两遍」与 5–7 次判指纹 `statSync`。
3. **`readJsonl` 两端读取都改为分块有界读**：tail 从文件末尾倒着分块 seek、head 从文件头正着分块读到够数即停，都不再整读再切。语义逐字不变：行以 `\n` 界定、末行允许无换行、`\r` 随行进文本、纯空白行不计数、窗口内坏行照旧计入 `skippedLines`（坏行占槽位不占 records 名额）。
   - 第三处全量读（`check` 智能提示）另治：它的真实需求是「累计条数够不够 50」这一**阈值判定**，总数从不打印，故改经有界 `head: 50` 读，以 `records.length + skippedLines` 作与原纯计数逐字等价的判定输入。纯计数入口 `countJsonlLines`（把坏行算进条数却不 parse）随之失去唯一生产消费者，按 ADR-0022 同判据删除，不留兼容壳。
   - `readJsonlEnds` 要的是全文行数（首末记录 + `totalLines`），保持整读路径不动。
4. **观察面按消费方口径供给，不给原始读把手**：`traceTail(limit)`（底层 `jsonl.readJsonlWindow` 一次分块读尾部行文本，按不同 limit 反复截窗——**先截行文本再 parse**，故坏行占槽位的口径与逐字各读一遍一致）、`sourceRoots()`（一次探测）。窗口上限取本 run 内最大消费方（20 条），请求超出即抛，不静默少给。`capabilities()`（能力表一次解析多消费）属步骤 4。不给 `lineCount`：需要总数的消费方已在决策 3 改为阈值判定，为它保留一次全文读是凭空造需求。
5. **验收两道，都是硬门槛**：① 计数假读盘件断言「一次运行内每个项目文件至多读一次」，形状照 `check.test.ts:78-106` 的 `recordingEvidence()`（真执行 + 只记命令串 + `new Set(commands).size === commands.length`）；② 固定项目跑 check，改前改后 stdout 与 trace 逐字节对比，证明判定一字未变。
6. **范围外，各自另立**：`traces.log` 轮转/上限（改变「历史上有多少 trace 可读」，是数据保留取舍，仓内已有按大小 rename 先例 `monitoring/context-tracker.ts:33,127`）；治理正本落点口径不一致（`governance-presence.ts:47-48` AGENTS 优先 / `injection-writer.ts:37`+`injection-drift.ts:89` CLAUDE 优先 / `context-builder.ts:151` 只看 CLAUDE 无回落——正确性问题，与本 ADR 的性能轴无关）；`DEFAULT_TRACE_FILE` 相对路径致 trace 落到 CWD 而非 `--project-path`（违反 harness#95 约定，缺陷票）；**步骤 3 接线时读出的第四项**——`--preset` 口径不一致：CLI 的 `options.preset` 恒有值（缺省 standard），故项目无自定义配置时 check 实际按 standard 评估（`effective-constraints.ts` 的工单 23 优先级规则），而漂移侧 `getEffectiveConstraints` 不带 preset、按 config.yml 的 `preset` 键生成期望段（`injection-drift.ts:120`）→ 对「无自定义配置 + config.yml 写了非 standard preset」的项目会稳定报假内容漂移。属判定正确性，与本 ADR 的性能轴无关，本票**不**顺手统一（统一会把 check 侧或漂移侧的判定改掉），留待缺陷票。

## 理由

- 收益归因要诚实，避免后续按 50–70ms 双倍期待：决策 3 落地后 `traces.log` 的**三处全文读已全部消失**（两处尾部读变分块 seek、第三处经实面核查本就是阈值判定，不该数全文），故决策 4 的 `traceLog()` 在这一点上**已无余量可拿**，只剩把并列的两处尾部读并成一次的可维护性收益；步骤 2–4 的净收益因此主要落在源根探测（7–11ms）、reconcile 共享解析（8–16ms）与配置装载（消除 2× 生效集链路）。
- 决策 1 的「只抬 `CheckEnv`、不留第二个概念」在动手时死于构造顺序（见决策 1 的更正），最终形态是两个**类型**、一份实现、一条读路径：`RunEnv` 承载「不需要 context 就能造」的观察面，`CheckEnv` 从它派生。原本仍然成立的判断保留——重复读有两处（context-builder、CLI 阈值读）根本不在 checker 层，硬塞给 checker 侧的环境对象是错的位置；checker 侧名字不动，12 个 checker 与 12 处 `buildCheckEnv` 测试零改。
- 决策 2 撤销进程级缓存是本 ADR 唯一带删改既有裁决的部分（工单 16）。当初加它正是为了躲测试同进程反复改文件；运行级快照出现后，那个理由由「快照跑完即弃」直接满足，指纹机制失去存在依据。

## 影响

- 代码 **已落**：`utils/jsonl.ts`（tail 倒读 + head 正读双向有界分块、新增 `readJsonlWindow` 尾部窗口、删 `countJsonlLines`、两处反向 docstring 改写）；`core/constraints/run-env.ts`（新建观察面 `traceTail(limit)` + `sourceRoots()` + 配置两口 `rawConfig()` / `customConstraints(fileName)`，懒建 + run 内 memo）；`core/constraints/context-builder.ts`（源根探测与两处 trace 证据探测改经观察面；`detectFailingTest`/`detectVerificationEvidence` 除本模块外零消费者，按 ADR-0022 同判据收为私有）；`cli/commands/check.ts`（入口造 env 向下传 + `getSmartHint` 改阈值读）；**步骤 3（配置一次装载）**：`core/project-config-loader.ts` 的进程级 `rawConfigCache` + mtime/size 指纹**已删**，本模块不再碰文件系统——config.yml 与自定义约束文件的读取全部下沉 `RunEnv`，`loadRawProjectConfig`/`getGovernanceConfig`/`resolveContextFiles`/`getCapabilitiesMode` 与 `ProjectConfigLoader` 构造器、`getMergedConstraintsConfig`/`getEffectiveConstraints`/`detectInjectionDrift` 的根入参放宽为 `RunTarget`（传路径 = 一次性读取语义，消费方零改动）；`CheckEnv` 改为 `extends RunEnv` 派生（`buildCheckEnv` 第三参可选注入），四个读配置的 checker（docs_freshness / capability_sync / context_doc_sync / governance_presence）改从 env 取；CLI 入口那枚 env 现向下传给生效集、context-builder、`checkConstraints`（经 `runAllConstraints`/`check`/`checkPrecondition` 逐层透传，`beforeExecution` 亦自造一枚供全 run 共用）与漂移检测。**生效集的合并计算仍跑两遍**（check 侧与漂移侧各一遍），但第二遍零 I/O、纯对象拷贝——不把 check 侧结果直接喂给漂移，是因为两侧 `--preset` 口径本就不同（决策 6 第四项），合并会改判定。
- 代码 **待做**：`core/constraints/checkers/{capability-sync,docs-freshness}.ts` 与 `doc-freshness/runner.ts`（源根改经 `env.sourceRoots()`、能力表一次解析多消费；顺带按 ADR-0016 补 `governance-presence.ts:50` 的 `console.error` 侧信道与 `context-doc-sync.ts` 两个漏迁 checker）、`core/constraints/capabilities-reconcile.ts` 两处相同解析输入合一次、`gates/checker-gate.ts:32`（随 `buildCheckEnv` 形状决定是否注入 env）。
- 公共面变更（ADR-0003 口径）：`./core` 新增 **两个类型导出** `RunEnv` / `RunTarget`（配置访问器族与 `ProjectConfigLoader` 的入参形状，纯增加、对消费方非 breaking，`public-type-surface.test.ts` 清单随之从 32 项增至 34 项）；`ConstraintChecker` 各方法的可选参数增 `runEnv`（该类本就是内部 seam，不在包根清单）。
- 测试（逐条记账）：`jsonl.test.ts` 补 tail 语义等价六组（CJK 跨块边界、末行无换行、CRLF、尾部空白行、`tail:0`/缺文件）；`jsonl-tail-seek.test.ts` → `jsonl-bounded-read.test.ts`（git mv）闸范围扩到两端有界读，模块层把 `readFileSync` 换成必炸作反证，并配「全文读确实必炸」一条自我检查；新增 `core/constraints/__tests__/run-env.test.ts`（memo / 懒建 / 缺文件 / 超上限抛错 / `projectPath` 锚定 / `traceTail(limit)` 与 `readJsonl({tail})` 逐字等价 / 两个证据探测各按自己窗口向 env 取数不另开读 / **配置组**：rawConfig 的 run 内 memo·懒建·缺文件·空文件回落·解析失败照抛不入库、customConstraints 取段与同名文件 memo 与按文件名分列、`resolveRunEnv` 归一语义）；`jsonl-skip-disposition.test.ts` **两处**：识别正则纳入 `readJsonlWindow`（否则「改用窗口读」成 skip 契约的逃逸通道，harness#114 同判据），冻结表把 `context-builder.ts: 2` 迁为 `run-env.ts: 1`（合并读点导致的站点迁移，豁免理由随读点搬走，非删条目留空），并新增 `check.ts: 1`；`appendJsonl` 用例借 `countJsonlLines` 做的断言改经存活的 `readJsonl` 表达同一事实（未弱化）；`context-tracker.test.ts` 与 `session-manager.test.ts` 的 `fs` 假件补有界读四件并收在 `test-setup/jsonl-fake-fs.ts`（两处消费方才立这条接缝），**两个文件断言一字未改**；步骤 3 随改：`governance-presence` 与 `no-hardcoded-credentials` 两套件里手写的 `CheckEnv` 字面量补 `...createRunEnv(dir)`（**12 处 `buildCheckEnv` 调用一字未改**，理由节那条断言仍成立）；`context-files-resolution.test.ts` 的 memo 用例从「进程级共享」改写为「同一枚 env 内共享」，并**新增反证一条**——同一路径先改后读必须读到新内容（旧指纹缓存放过的正是这个）；`project-path-convention.test.ts` 冻结表随站点变化更新（`project-config-loader.ts` 的构造兜底搬进 `resolveRunEnv`，故该条目消失、`run-env.ts` 新增；`checker.ts` 三处 run 入口改为先取一次根再派生证据与观察面）。待做：`check.test.ts` 的 git 计数闸扩为文件读计数闸（基线：studio 干净树 595 次 fs 操作、pre-commit ≈650–700）。
- 文档：`src/CONTEXT.md` 术语表加「运行级环境（run environment）」条目并写明其唯一正本落点；`src/core/CONTEXT.md` 的 `CheckEnv` 描述由「checker 的环境」改写为「一次 check 的统一环境，入口构造」；`utils/jsonl.ts` 头部关于「全量读取廉价」的断言按实测改写。
- 交付顺序按步独立提交，每步有可回滚 checkpoint：步骤1 jsonl → 步骤2 环境对象提到入口 → 步骤3 配置一次装载 → 步骤4 源根/reconcile 共享 → 步骤5 计数与等值验收（计数测试随各步同 commit，不单独攒）。
