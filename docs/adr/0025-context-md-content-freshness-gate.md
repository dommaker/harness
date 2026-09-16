# ADR-0025: CONTEXT.md 新鲜度判定由 mtime 换为内容判定并进 governance CI

- 日期：2026-09-16
- 状态：已接受
- 影响版本：随下个 minor 发布，含 `sync-docs --check` 语义收紧（CHANGELOG 标 `!`，见「影响」）
- 关联：harness#142（票下 Agent Brief 四项裁决为本 ADR 的正本）；ADR-0009（同一套「覆盖/幽灵」判据、同一「纯判定 + 调用方组装」形状）；ADR-0003（公开面/内部 seam 的归属判据）；ADR-0022（零消费者面不登记）；harness#120 方案 A（CAPABILITIES 漏登门先例：自愈照做，但「需要自愈」本身成为门）；harness#136/#137（两票 CHANGELOG 条目各自记名过同一批 mtime 假灯）

## 背景

`sync-docs --check` 对 CONTEXT.md 的过时判定此前是**纯 mtime 比较**：目录内最新 `.ts` 的时间戳晚于 `CONTEXT.md` 即报过时。三种失真都实测过：

1. **改一行注释也算漂移**——判定不看内容，源码任何写入都报警。
2. **什么都不改、只碰时间戳也算**——任何一次 `git checkout` / `git stash` / cherry-pick / 跨分支切 checkout 都会让源文件 mtime 变「新」。票 #142 证据评论记录得很具体：`src/cli/commands/CONTEXT.md` 当天被 6 张票逐个更新过、`git status` 干净、内容与实现相符，却因一次变异还原（改源文件跑测试 → `git checkout --`）被报过时。本会话同一命令又报出 6 处、与票面 4 处**不重合**，即同一棵树在不同时刻给出不同答案。
3. **接口真变了反而漏报**——文档比代码晚写一次就把整目录洗白，无论那一次改了幾個符号。

而 CI 侧只钉 `CAPABILITIES.md`：`harness-governance.yml` 的顺序是 `check` → `passes-gate` → `sync-docs`（写入，自愈幽灵/缺登记）→ 只对 `CAPABILITIES.md` 的 diff 报错。CONTEXT.md 无论漂多远 CI 都不会红——本票那 4 处存量正是这么攒出来的。这类漂移对本仓的伤害比对人更大：agent 读代码前先读 `CONTEXT.md`，读到不实陈述会直接下游误判。

对照判据不是新造：`CAPABILITIES.md` 侧已有 ADR-0009 的单一对照 module（覆盖 = 代码有而文档漏；幽灵 = 文档说有而代码没有），studio 侧另有 `sync-docs --check --agents` 的内容漂移闸实践。缺的是把同一套语义搬到 CONTEXT.md，并让它在 CI 里说话。

## 决策

### 1. 判定归一个新纯 module，与 capabilities-reconcile 相邻

`src/core/constraints/context-reconcile.ts`（包内模块，不进 `src/index.ts` 导出面）：

- `reconcileContext({ contextMdContent, exportSurface, barrelExports? })` → `{ declaredSymbols, ghosts, unlistedBarrelExports, hasCoreExportsSection }`。
- 两个口径正本同住此模块、同为纯函数：`parseDeclaredExportSymbols(content)`（文档侧）与 `parseExportStatements(source)`（源码侧，交导出名 + **本名**（`a as b` 的 a）+ 是否类型-only + `export *` 的待解析 spec）。
- **fs 采集留在调用方**（`cli/commands/sync-docs/context-syncer.ts` 的 `collectContextExportSurface`）：目录遍历、正文读取、`export *` 与具名再导出的目标解析都在 cli 侧——与 ADR-0009 的「判定不吃 fs，清单由调用方组装」逐字同形，判定面因此可以完全用字符串夹具测（19 项旁测零 fs fixture）。采集侧一条硬规矩：**具名再导出要按正本核对**——`export { A } from './x'` 只在 `./x` 真导出 A 时才算数（带别名时拿本名去核），环上核不到正本时按「不知道」从宽、不作「没有」判。这条是反证撞出来的：只改声明侧的类名而 barrel 不动时，虚再导出若被算进导出面，文档里的幽灵就被 barrel 自己洗白，闸恰好漏掉它最该抓的那种改名。

不新造第二套对照逻辑：幽灵/覆盖这套语义在仓内只有 `capabilities-reconcile` 与这里的两份，且二者都不含 fs。

### 2. 双向口径

- **幽灵方向（文档→代码）**：`## 核心导出` 节 bullet **行首**反引号标识符，必须存在于目录导出面（目录内所有 `.ts`（排 `__tests__/`、`*.d.ts`）的导出名，含类型与内部 seam）。不存在 → 判漂移。
  - 行首而非全行：bullet 中段的反引号是散文里的方法名/文件名（`readReport(filter?)`、`saveAll()`），把它们当导出声明会把文档写成符号登记表。
  - `/` 连接视为多个声明（`bootstrapHarness` / `bootstrapHarnessSync`）；形参列表与 `（type）`注解剥掉；**剥完不是合法标识符的整条跳过**（`types.ts`、`audit-scoring`、`constraints/`、`spec/validator` 这类模块/目录条目 bullet 不属符号声明面，本仓 5 个目录的文档就是这么写的）。
- **导出面 = 目录内所有 `.ts` 的导出名并集**（含 barrel 与内部 seam、含类型），故「某个内部文件仍导出它」不足以救幽灵——改名必须改到声明处，这正是本闸要抓的动作。
- **覆盖方向（代码→文档）**：目录 `index.ts` barrel 再导出的符号必须**出现在**该节（行首声明或 inline 提及皆可，标识符边界匹配——`Gate` 不因文档里有 `GateResult` 而算登记）；缺失即漂移。**无 `index.ts` 的目录跳过此方向**（内部 seam 符号登记与否是文档裁量，`release/CONTEXT.md` 是先例）。

### 3. 覆盖方向只判 barrel 的**值**符号，类型面豁免

票体验收 4 要的是「可操作口径」，这条就是。按字面把 barrel 全部再导出符号都要求登记，实测需要往 12 份文档里补约 500 个类型名（`core` 一个 barrel 就有 63 项再导出）——那是「连注释都要改」的另一种形态，而且类型面已经有机器闸了：`public-type-surface.test.ts` / `public-value-surface.test.ts` 冻结名字清单， CONTEXT 文档不需要重做一遍登记表。

于是严格度是**不对称**的，且这个不对称就是本 ADR 的口径：

- 说谎必红（幽灵方向对值与类型一视同仁——文档写 `HookConfig`（type）就必须真有其物）。
- 漏登记只对**公开值面**要求逐个可见（新增一个公开函数必须进文档；新增一个可选配置类型不必）。

### 4. 级别内建：内容漂移 fail、mtime 提示 warn、CI 抑制提示

- `--check` 下内容漂移 → `fail`，`reason` 直接点名文件与符号（不靠翻 stdout）。
- mtime 漂移 → 只打提示，**不影响退出码**；`process.env.CI` 置位时连提示都不打（全新 checkout 的 mtime 由 clone 顺序决定，同目录 `CONTEXT.md` 排序恒先于 `.ts`，恒假阳性）。
- **不加独立 CLI 开关**区分两套判定（Brief 裁决 3）：一个 `--check`，级别内建。
- 写入模式（无 `--check`）不自动改写 CONTEXT.md——散文不可机械生成；内容漂移只输出提示，退出码面不变（历史行为）。
- `--json` 增 `contentDrift: [{dir, file, ghosts, unlisted}]` 与 `summary.contextContentDrift`；`contextStale` 保留但自此只装 mtime 提示（CI 下恒空）。

### 5. 进 CI：governance 工作流加一步 `sync-docs --check`

位置在 CAPABILITIES diff 门**之后**。不走「写入 + diff 门」那套（那是可机械自愈的表格格式专属）：CONTEXT 判红时用户要做的是改文档或记票面，`sync-docs` 帮不上。对齐 #120 方案 A：**清完存量直接变红**，不给 warning + 限期档（给了就等于没接——第一批误报会把它磨成「预期失败」）。

### 6. 存量清理范围 = 闸报出的全部；核对另出的「代码待改」另开票

闸落地后对本仓实测：内容漂移 7 个目录、共 32 项（31 项未登记 + 1 项幽灵）。票面点名的 5 处里，hooks 与 release **零报出**——其「核心导出」节的符号声明与目录导出面逐项对得上，漂移全在非符号叙述（见下）；knowledge(3) / monitoring(3) / cli/commands(1) 有报出。`cli/commands` 那 1 项是 bullet 行首反引号写的是 CLI 子命令名 `command`（不是导出符号）——按「行首 = 声明」的约定给该 bullet 加散文前缀，句子一字未删。其余 31 项是覆盖方向报出的**真实漏登记的公开值符号**（core 12 / failure 7 / gates 5 / knowledge 3 / monitoring 3 / context 1），一并补进文档；票面的「4 处」清单因此在执行时扩为「闸的全部报出」，否则 AC3（CI 步骤）落不了地。

逐条核对（闸只判符号面，散文叙述靠人读）另出两类结果，都写进了票面：

- **五处不实陈述改正文档**（不删句子，改成与代码一致的说法）：hooks 的类型正本位置（在 `src/hooks/types.ts`，`src/types/` 里没有 hook 类型）与两条已失效的消费边（core / CLI 初始化流程，调用边随零消费者清账消失）、`HookRegistry` 方法枚举漏 3 个；monitoring 的读入口枚举漏 `getStats()`、`ContextTracker` 的消费边（`context/session-manager`）未列；knowledge 的 `依赖 src/types/` 不实与 `audit-scoring`「不进导出面」对类型面为假；release 的「同步闸门强制同步」归属写错。
- **五处「文档说的是应有语义、代码没做到」不改文档、另开缺陷票**：hooks `HookConfig.enabled`/`errorStrategy` 零读取点（#159）、release 包根清单闸门只做正向 `toContain`（#160）、knowledge `migrateKnowledgeEntries` 把 `absent` 报进 `errors` 与 `utils/frontmatter.ts` 的正本裁决相反 + 外部内容三层防御第二层 `formatForPrompt` 生产零接线 + `rule` 降级边界差一（三条同属 #161）。五处均在各自 `CONTEXT.md` 的原句就地标为「现状偏差」并指回缺陷票，防止下一个读者把应然读成正然。

这也是本闸**故意只判符号面**的理由：散文叙述的对错机械不可判，能判的那一半（导出面对撞）落成闸，判不了的那一半留在票面与人身上。

## 理由

- 判据换成「代码说什么、文档说什么」的对撞，而不是「谁的文件系统时间戳新」。前者可执法，后者连稳定复现都做不到（同一棵树两次运行结果不同）。
- 判定与采集分离后，本票新增的行为几乎全部可用字符串夹具测；`sync-docs` 侧只测接线（12 项），采集侧只测解析与遍历（5 项）。
- 单一 module 承载两方向，与 ADR-0009 同判据：将来 `docs_freshness`/`context_doc_sync` 这类检查器若要执法 CONTEXT 新鲜度，消费的是同一份判定，不再各写一遍。

## 影响

- **对消费方变严（release note 必提）**：升级后 `sync-docs --check` 的判定面新增 CONTEXT 内容漂移。studio 侧 49 个 CONTEXT.md 会获得这套新判定，其修复不在本票。**已核实的缓冲**：init 生成的消费者工作流（`scaffold-templates.ts` 的 `renderGovernanceWorkflow`）里 `sync-docs --check` 步骤带 `continue-on-error: true`（GitHub）/ `allow_failure: true`（GitLab），故消费方 CI 不会因本变更直接变红，报出的漂移表现为步骤内的非阻断输出；去掉这层缓冲属消费方自己的裁决。
- **harness 自身**：`harness-governance.yml` 新增一步 `Gate on stale CONTEXT.md`（阻断）。存量已随本票清零，故进 CI 当天即绿。
- **退出码语义变化（`!`）**：原本「源码比文档新」会让 `--check` 退非零，现在不会（降为提示，CI 下不提示）；原本 CONTEXT 内容漂移永远不报，现在 `--check` 退非零并点名文件与符号。两条同向——**判定面从「时间戳」换成「内容」**，不是单纯放松或单纯收紧。
- **已知限度（登记，不掩盖）**：
  - 绕闸路径存在——删掉整节、或删掉那行 bullet，漂移就消失。这是散文文档的固有面（`capabilities-reconcile` 对表格同样如此）；本仓的对策是票面纪律「不得删句子以让它看起来不漂」+ 统一复审，而非再加一道机械闸。
  - 无 `## 核心导出` 节的 CONTEXT.md 两方向都不参与（散文式文档不罚），代价是「删节」比「删行」更省事。
  - 导出面是**正则解析源文本**，不经过类型检查：模板字符串里以行首 `export ` 开头的示例代码会被当成导出（假阴，只会少报幽灵，不会误报）；`export *` 只沿仓内可解析的相对 spec 展开。
  - `default` 导出计入导出面但不要求登记（barrel 无 default 再导出，本仓实测零命中）。
- **不在本票**（票面 Out of scope）：`--agents` 那半张闸（实测 AGENTS.md 零漂移）；`capabilities-reconcile` 既有判定逻辑；「核心导出」之外各节的内容判定。
