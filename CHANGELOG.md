# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changes
- chore(cleanup): 零消费者与转发链第三轮·机械清账（#137，架构评审 2026-09-14 候选 8 + ADR-0022 判据）——判据照旧是删除测试：删掉后复杂度消失/集中，还是只是搬家。**删**三处零生产消费者：① `utils/exec.ts` 的 `isCommandAvailable()`/`delay()`（同文件 `runCommand()` 按票面保留）；② `ProjectConfigLoader.isConstraintEnabled()`/`getConstraintSource()`——ADR-0022 型漏收，二者是 `mergeConstraints` → `getEffectiveConstraints`（ADR-0001 唯一生效集来源）的平行复印；③ `failure/types.ts` 兼容再导出 shim（工单 14 已把类型正本归位 `types/failure.ts`，转发链 `failure/types` → `types/failure` → `failure/index` → 包根的三跳里两跳是星号），删除后 classifier/recorder 与三个测试文件直连正本。**归位**：`normalizeTriggers()`/`matchesTrigger()` 从 `utils/exec.ts` 迁到新增 `core/constraints/triggers.ts`——harness#105 定的 trigger 匹配语义单点，此前住在 utils 层等于给 utils 挂一枚只有约束域会调的假接缝，`constraints/checker.ts` 与 `agent-prompt-renderer.ts` 的拉用点随之转为同目录 import。**子 barrel 星号收口**：票面点名的 8 处目录级 `export *` 全部改显式清单（`agents/index.ts` 2 处、`completion-checkers`、`failure/index.ts`、`hooks`、`knowledge`、`tools`），第 8 处即 `failure/types.ts` 那枚 shim——按票面「与 shim 一起裁决，避免一处删一处留」取删而非改写，故**零豁免条目**；同批新增 `src/__tests__/sub-barrels-explicit.test.ts` 把这条例子落成闸（src 下每个 barrel 扫 `export *`/`export type *`，豁免须逐文件登记理由，且登记了却已无星号也算死账红），ADR-0003 的禁令从此不只钉五个 `exports` 入口。**分层闸参数化**：`src/__tests__/layering.test.ts` 原先只守 `src/core/**` ↛ `cli`/`gates`/`monitoring` 一条边，types/utils 的回边与领域层互 import（如 `context/session-manager.ts` → `monitoring`）全部放行；改为「每个顶层单元（目录 + src 根文件）声明允许的下行集合、逐目录冻结」——20 个单元各一条 `DOWNSTREAM` 条目（新增登记闸双向对撞：未登记的新目录即红、登记了却已不存在的单元也红），测试文件另走 `TEST_ONLY_EDGES` 单列放行（夹具、core 测试回读包根 barrel、failure 测试覆盖 CLI 命令），免得把「failure 可值导入 cli」宣布进生产面；同层债逐条带注（`context` → knowledge/monitoring、`hooks` → monitoring 组合根），集合只多不减、还清即删条目。`scanViolations(relPath, code)` 改成纯函数（代码不从磁盘取），于是**反证进测试**：11 条合成越界边各红一次并指名到单元/文件/目标/源串，11 条合法边与噪声（type-only、同目录、node 内置、字符串字面量、注释里的示例 import）不误报——不再需要往 src 里塞临时文件；文件级真反证另做：`src/types/__night_probe__.ts` 注入 `import { constraintsReport } from '../cli/commands/constraints-report'` → 「types 零越界值 import」单项转红并打出该边，删探针后还原。**retire 内部重构**（`cli/commands/constraints-retire.ts`）：两段约 27 行、只差键路径的 YAML 读-改-写合成一个 `setYamlEntry(filePath, label, section, id, patch)`；同一次 `retireConstraint` 里 `new ProjectConfigLoader().load()` 由 2–3 枚收成**一份观察面**（ADR-0023 决策 2 的形状，定义查找 / already_retired 判定 / custom 文件名解析共用；写盘后 `syncGovernanceInjection` 必须读新状态，故仍另起一枚）；`:311` 手拼的退役判定改为复用 `project-config-loader` 新增导出的 `isConstraintRetired(customDef, disabled)`——它本就是 `mergeConstraints` 那条「禁用或条目带 `retired` 即不追加」规则的复印，现两处共消费。**验收 6 的落盘逐字一致由测试钉**：新增两枚逐字节冻结用例（内置落 config.yml、custom 落 custom-constraints.yml，含带注释原文件被重写的形态），钉的是 YAML 文本而非 `yaml.load` 后的对象——键序、两空格缩进、`lineWidth: 120`、`at:` 的单引号形状全在断言范围内；两枚用例在**重构前**先跑绿（照现状取基线），重构后逐字仍绿。装载次数由新用例钉住（custom 路径 `load()` 实测 3 次 → 1 次，红基线 3）。**公共面定级**（ADR-0022 追记第 5 条口径，双证据 = 五个 `exports` 入口源文件 + 已发布 npm 产物 `@dommaker/harness@1.7.0` 的 `.d.ts`）：`isCommandAvailable`/`delay`/`normalizeTriggers`/`matchesTrigger` **非 breaking**——五个入口文件与五入口 `.d.ts` 全部零命中，它们只在随包出厂的 `dist/utils/exec.d.ts` 这份**文件**里，而 1.7.0 的 `exports` 恰只有 `.`/`./core`/`./presets`/`./context`/`./gates` 五个入口，深路径不可解析；`failure/types.ts` 同判（`dist/failure/types.d.ts` 出厂但不可经入口可达）；`isConstraintEnabled`/`getConstraintSource` 是**类型面 breaking on `./core`**——`ProjectConfigLoader` 经 `dist/core/index.d.ts:13` 再导出，两方法签名在 published `dist/core/project-config-loader.d.ts:107,111`，删方法即改公开类面（值面冻结闸看不见类成员，故按人工双证据定级，见上），迁移路径 = 删引用（票面双仓核实零消费者）；barrel 显式化与 `isConstraintRetired` 新增 **零公共面变化**——三道公共面闸（`public-exports`/`public-type-surface`/`public-value-surface`）清单零改动且全绿，即「五入口名字清单逐字未变」的机器证据。发布级别：含 breaking 一项，按 2026-09-09 人类裁决走 **minor**。**记名复核**：票面称 `runCommand` 已有生产消费者（`check-cache.ts`、`git-evidence.ts`），本仓复核那两处命中是**文档注释**（`check-cache.ts:17` 示例、`git-evidence.ts:46` 缓冲上限说明）而非 import——`runCommand` 当下生产消费者为 0，但票面明文「不得删」，故保留并在此记名，删不删由下一轮按同判据裁。**范围外不动**：`package.json` 子路径入口（`./core`/`./presets`/`./context`/`./gates`）删除按票面属 #131 阻塞项（值面冻结闸现已由 #131 落地，但删除另须裁决，不在本票）；票面「明确不再提」清单（presets/、tools/、sdd ⊕ cli、monitoring collector↔analyzer、completion-checkers/、hooks/ 与 agents/、flywheel-metrics、capabilities-reconcile、KnowledgeLinter/HealthScorer）一律未碰。测试：新增 3 个文件（`core/constraints/__tests__/triggers.test.ts` 13 项随迁用例、`__tests__/sub-barrels-explicit.test.ts` 5 项、layering 参数化 52 项含反证）+ retire 3 项 + loader 4 项；删除面双向钉（`@ts-expect-error` 编译期钉 + 运行时键/原型断言），删多与复活都红。验收：`npx jest --runInBand --coverage` 172 套件 / 2471 passed / 6 skipped、覆盖率 **94.47% stmts**（#136 的 94.46% 不降；`core/constraints/triggers.ts` 四项 100%、`utils/exec.ts` 收缩后仍 100%）、`npm test` 并行 4 worker 同绿、`tsc --noEmit` 与 `eslint src` 零错、`npm run build` 绿且产物内零 `export *`、`node bin/harness.js check` 通过（铁律 3/3、指导原则 3/3）。文档：`src/CONTEXT.md` 把「禁 export *」的管辖面改写为「src 下全部目录 barrel + 豁免逐文件记名」；`src/core/CONTEXT.md` 补 `constraints/triggers.ts` 归位与 `isConstraintRetired` 判定单点两条、并把分层守卫描述改成参数化口径；`src/failure/CONTEXT.md` 的 `types.ts` 条目随 shim 消失改为「barrel 直连类型正本」。已知残留：`sync-docs --check` 的「CONTEXT.md 可能过时（源码比文档新）」位点由 4 处（hooks/knowledge/monitoring/release，#136 记名的既有漂移）增至 8 处——新增 4 处是本票动过 barrel/命令文件的 agents、completion-checkers、tools、cli/commands，逐条核对是 mtime 信号而非内容漂移（这些文档记的是模块级导出与职责，星号改显式清单不改它们所述的对外面），未为凑新鲜度改写正文
- perf(tests): `http_*` 检查族的重试退避加「等待」注入缝——串行套件不再为重试真等 24 秒（#136，架构评审 2026-09-14 候选 7）——`src/core/validators/check-handlers/http.ts` 的 `fetchWithRetry()` 把退避等待内联成 `await new Promise(r => setTimeout(r, 2000 * (i + 1)))`（状态码分支与 catch 分支各一处），`2000` 与 `retries = 3` 都是硬事实、无注入口。后果是最慢的测试路径与生产正确性无关：两个「mock fetch 直接 reject」的用例各真烧 2+4+6s，本会话基线实测 `src/__tests__/checkpoint.test.ts` 单套件 `--runInBand` **27.19 秒**，其中 **24.01 秒**（12002ms + 12012ms）就是这两处真等待（票面「约 45% 串行占比」复核成立；其余 44 条用例体合计约 77ms）。落地按 triage 裁决取方案 A 并修正其注入车辆（原措辞「sleep 提为 handler 可注入形参」与验证器固定的 `(check, context)` 分发不合——形参加不进去）：`CheckpointContext` 加可选 `sleep?: (ms: number) => Promise<void>`（同类型既有的调用方注入位 `customHandlers` 已是这形状），`checkHttpStatus` / `checkHttpBody` 由「收 context 而从不读」改为把 `context.sleep` 透传给 `fetchWithRetry()` 的新形参，形参缺省 = 模块私有的真定时器实现，退避公式 `2000 × (n+1)`、`retries = 3`、调用点全部逐字不动。**不做** `retries` 与退避基数的可配置化（票面方案 A 的后半句按 2026-09-15 裁决移出——验收正是对着这两个固定缺省写的，投机可配置违反仓 simplicity first）；**不取** jest fake timers（方案 B，裁决：要为待决 promise 重排测试并手动推进计时器，且与处理器用的原生 `AbortSignal.timeout` 相冲）。**对外行为变化 0 处**，定级非 breaking：发布类型 `CheckpointContext` 追加一个**可选**字段，未注入时缺省路径逐字不变，命令语法 / 旗帜集合 / 退出码 / 五入口公共面名字清单零改动（`public-exports`·`public-type-surface`·`public-value-surface` 三闸零改动），下游按 `CheckpointContext` 构造对象的代码不受影响。测试：新增 `src/core/validators/__tests__/http-retry-sleep.test.ts` 10 项——注入替身侧 8 项把重试语义钉成「尝试次数 = retries + 1（fetch 恰被调 4 次）」与「退避序列 = 2000/4000/6000」（`http_status`：持续抛错 / 5xx 后恢复 / 429 后恢复 / 5xx 用尽后返回最后响应判不匹配 / 404 非可重试只试一次 / 首次即成功零退避；`http_body`：持续抛错与不重试两形），另两项分别为**分发接线闸**（经 `CheckpointValidator.validate()` 传入，证明 context 真抵达 handler，而非只在直接调用的形状里成立）与**缺省路径闸**（不注入 sleep，用同步触发的 `setTimeout` 替身记到 `[2000, 4000, 6000]`——生产缺省仍是真定时器且序列不变，而这一项自身零真等待）；既有两条重试用例改为注入记录型零等待 sleep，断言只增不减（`passed` + `message` 两条原样保留，新增尝试次数与退避序列两条），随真等待消失移除其 `20_000` 毫秒超时兜底。**三道反向验闸各改坏一次并还原现场**：`checkHttpStatus` 改回不读 `context.sleep` → 注入侧 4 项 + 接线项红（且各退化到 5 秒超时，正是本票要消掉的形态）；缺省 `realSleep` 改 no-op → 仅缺省路径项红；`retries = 3` 改 2 → 尝试次数与三项序列的断言共 7 项红（含既有套件那 2 项）。**前后对照**：`checkpoint.test.ts` 套件墙钟 **27.19s → 1.87s**（`--runInBand`，热缓存；本机 4 核并发负载均值 7.7 时另测得 2.9–4.2s，故同时给负载无关的口径——46 条**用例体合计 24.09s → 82ms**，两条重试用例 12002+12012ms → 3+2ms）；全量 `npx jest --runInBand --coverage` 170 套件 / 2420 passed / 6 skipped、覆盖率 **94.46% stmts**（#134 记的 94.29% 不降）、`npm test` 并行 4 worker 同绿（21.4s，票面提到的并行 SIGTERM 现象本会话未复现）、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过（铁律 3/3、指导原则 3/3）、`sync-docs --check` 仍只剩 hooks/knowledge/monitoring/release 四处既有漂移。文档：`src/core/CONTEXT.md` 的 `validators/` 条目补记「`check-handlers/` 各族统一 `(check, context)`，context 即注入车辆，等待类副作用经 `CheckpointContext.sleep` 注入、不再内联」。范围外按票面裁决不动：`src/cli/commands/posteval-plan.ts` 里另一份同名 `fetchWithRetry`（自带 `retries` 形参、无等待注入口，但不是本票的 interface）；约 30 个测试文件共用的固定 `temp-test-*` 工作目录模式（含 `src/knowledge/__tests__/store.test.ts`）——triage 判为独立关注点、与观测到的 SIGTERM 大概率无关，是否另票属 maintainer 决定，本票未碰
- refactor(gates): `CommandGate` 三条同构匹配循环收成一个谓词 + 两个零消费者配置位删除（#135，架构评审 2026-09-14 候选 6）——`CommandGate` 的一份规则表服务三个入口（`check()` 经 `checkBlacklist()`、`isAllowed()`、`getRiskLevel()`），三条循环逐行同构（类别忽略 → 模式测试 → 按级别分派），改一条匹配语义要动三处；同批核出三处「声明与执法背离」：① `CommandGateConfig.strict` 的类型注释承诺「warn 也阻止」、CLI `--strict` 把它写进构造参数，而三条判定循环从不读取它（全仓唯一读取点在构造器）——带不带旗帜判定完全一致；② `CommandGateConfig.customBlacklist` 除构造器与类型声明外两仓零生产注入者（`addRule()` 才是已存在的运行时扩展点），是给下游的假扩展点；③ CLI 默认分支用带配置创建的实例、`--level` 分支却调模块级单例出口，传进去的配置到不了判定。三份同构循环还顺带藏着第四个后果：`getRiskLevel()` 取规则表里**首条**命中的级别，若首条级别较低而命中集合里另有阻断级，它报出的等级与同一条目在 `check()` / `isAllowed()` 上的裁决相反（`--level` 因此可判 high 之外而默认分支判阻断，退出码 0）。落地按 triage 两项裁决（判据 ADR-0018 / ADR-0022）：**匹配单点化**——新增私有谓词 `matchCommand(command) → 命中规则集合`（遍历规则表、类别忽略、模式测试只在此处）与折裁点 `judge(command)`（级别 → 三桶 + `allowed` + `riskLevel` 只在此处解释），三个入口退化为该裁决的三个投影，等级改取命中集合最高档（不变式「存在阻断级命中 ⟺ `check` 不通过 ⟺ `isAllowed` false ⟺ 等级 high」）；**两个配置位删**——`strict` 不接进判定（接进等于为一个零消费者开关新增「warn 级命中从此阻断」的执法语义），连 CLI `--strict` 旗帜一并 removal，`customBlacklist` 连同构造器合并段删除。**对外行为变化**（breaking，发布级别随本车 ship 时裁决，判据同 ADR-0018/0022 的 minor 先例；studio 侧对删除面零引用）：`CommandGateConfig` 收缩两字段（现只剩 `ignoreCategories`）、`harness command` 删 `--strict` 选项、多重命中输入上 `harness command --level` 报告的等级可能由低变高（但与同一条目的裁决一致）。第三项裁决同时把 hook 侧现状定成正本：`src/pretool-use-hook.ts` **保持裸构造**、不引入项目配置装载（「hook 只用出厂规则、fail-open」写进 `src/gates/CONTEXT.md`，配置装载只属于 CLI 侧），CLI 的 `--level` 与默认分支改共用它创建的那台实例。测试：新增 `src/gates/__tests__/command-single-predicate.test.ts`（**源形状闸**：`pattern.test(` / `ignoreCategories.includes(` / 遍历规则表的循环体各恰好一处、级别 `switch` 归零——红基线实测 3/3/3；**三投影一致性闸**：单条命中、不变式对撞、**次序无关的正对照**（warn 排在 block 前 → 旧语义报 medium、新语义 high）、忽略类别对三投影同样生效，输入一律用 `addRule()` 挂的合成规则，不涉规则表内容）+ `src/cli/commands/__tests__/command-gate-dead-options.test.ts`（定义表旗帜面逐字冻结不含 `--strict`、`@ts-expect-error` 编译期钉三个已删字段、配置读取面运行期形状钉、CLI 源面禁再引单例出口；手法照 `passes-gate-dead-options.test.ts`）；既有 `customBlacklist` 用例改走 `addRule()`；CLI `--level` 替身补 `getRiskLevel` 并新增「等级取自本命令创建的那台实例、全程只创建一次」；`project-path-convention.test.ts` 的 cwd 豁免理由随旗帜面收缩改字。三道闸先红后绿。记名不动：三个模块级便捷出口（`getCommandGate` / `isCommandAllowed` / `getCommandRiskLevel`）自此在本仓生产路径零消费者，但它们是包根与 `./gates` 的冻结公开面，删除属另一张公共面收缩票（ADR-0022 口径）。对外措辞纪律（PIT-021）：本票的 commit message / CONTEXT / ADR 只写泛化表述，不复述规则表内容、不写具体规则的匹配样例与生效范围结论。验收：`npx jest --runInBand --coverage` 169 套件 / 2410 passed / 6 skipped、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过、真 CLI 冒烟（`command --list` / 默认裁决 / `--level` 两档 / `--json` / 已删旗帜报错）。文档：新增 `docs/adr/0024-command-gate-single-predicate-and-config-trim.md`（两项删除裁决与判据、hook 决定、记名残留）+ `src/gates/CONTEXT.md` 两条约定（匹配语义单一落点、hook 只用出厂规则）
- refactor(knowledge): `KnowledgeAudit` 改收 store + 补「按 id 部分更新」的批量出口 + 知识树排除口径单点化（#134，架构评审 2026-09-14 候选 5）——`lint` / `doctor` / `query` / `lifecycle` / `ingest` 五个兄弟模块全部「构造收 store」，唯独 `KnowledgeAudit` 收 `baseDir` 并自建 `FileKnowledgeStore`，后果是 D1–D7 纯打分判定**必须先有真目录**：`audit.test.ts` 里 `makeTmpDir()` 出现 **47 次**，全部只因构造签名（该构造顺带 `mkdir`）。同车的三处放大与一处口径分叉：① 修复/衰减循环逐条 `store.update()`，而 `update()` = get→save、`save()` 每次全量重写 `index.json` → 一次 `audit --fix` 的代价 = 问题条数 × 一次全量索引重写；② 打分核心内嵌两处 IO（直读 baseDir 下 `.consumption-stats.json`、经 `getSurvivalRate()` 读快照），纯判定与取数搅在一起；③ 知识树 4 套 walker 各写各的排除清单，`harness knowledge index` 落在 baseDir 的生成物 `_index.md`（无 frontmatter）被 `harness knowledge migrate` 判成 `no frontmatter found` 计入 errors——同一份树两个命令两套人口，且 `knowledge audit` 的人读路径收尾就重建 `_index.md`，故这条在真实使用里必然发生（实跑复核：1 条目 + `_index.md` → `total: 2 / errors: ["_index.md: no frontmatter found"]`，同一目录 `store.list()` 只报 1 条）。落地按 triage 三项裁决：**拆纯模块**——新增 `audit-scoring.ts`（规则表 + `scanEntries` / `summarizeIssues` / `computeDimensions` / `calculateHealthScore`，零 fs，环境数据经 `AuditEnv` 喂入），`audit.ts` 693 → 135 行退化为 store 装配层；**两处 IO 归 store 供给**（不走 RunEnv——那是 check 侧对项目/git 的观察面，owner 不对）新增 `store.getConsumptionStats()`（照 `getSurvivalRate()` 形状；缺文件/坏 JSON = `undefined`，即「无数据」而非「零消费」）；**新增 `applyAll(updates)`**——与 `saveAll` 是两个函数、不改 `saveAll` 签名（它有 cold-start import 4 处生产消费），语义 = `update(id, partial)` 的批量形（逐条 get→合并→只更内存索引→结束单次 `writeIndex`；未知 id 逐条跳过、空批零读写），`audit --fix`、`lifecycle.runDecayCycle()`、`reference-tracker.updateReferencedBy()` 三个循环改走它（顺带把 `save` / `saveAll` / `applyAll` 三处各抄一遍的「条目文件正文落盘」写法收成 `store.writeEntryFile()`，落盘字节逐字不变）；**排除口径统一到「排除」**——新增 `tree-walker.ts`（`isEntryFile` / `isInfraDir` / `INDEX_MD_FILE` / `SNAPSHOTS_DIR`），store 顶层扫描、migration 顶层扫描、index-generator 递归扫描三处共消费同一份；`import.ts` 的 docs 扫描按「吃的是**项目文档树**、本口径在它那里没有对应物」原地记名而不改（统一的是排除口径，不是遍历深度——store/migration 顶层、index-generator 递归，这是现状不是分歧）。**对外行为变化 3 处**：① **breaking**——包根公开类 `KnowledgeAudit` 构造签名由 `new KnowledgeAudit({ baseDir, … })` 变为 `new KnowledgeAudit(store, { 阈值 })`，`AuditOptions` 随之去掉 `baseDir` 与**从未被读取过**的 `autoFix` 字段（类型名保留，`public-type-surface` 五入口清单零改动），迁移路径 = 先 `new FileKnowledgeStore({ baseDir })` 再把它传进来；② `knowledge migrate` 不再把 `_index.md` 计入 `errors`，`total` 也不再把它算进人口（假阳性修正，`migrate --json` 两个计数随之变小）；③ 库调用方可见的写放大收敛：一次 `audit --fix` / 一轮 `runDecayCycle()` / 一次 `updateReferencedBy()` 的 `index.json` 重写次数由「修复条数」降为 **1**（条目 `.md` 的写次数逐条不变）。定级：随本车 ship 时裁决，判据同 `[1.7.0]`（本包唯一消费者为 studio，且 studio 侧按 `KnowledgeAudit({baseDir})` 直调——`.scratch/harness-deep-clean/research-studio-usage.md:157` 记着这形，故 ① 需 studio 同步跟进，属 ship-chain 阶段 2 的采纳动作）。测试：`audit.test.ts` 的 `makeTmpDir()` **47 → 5**（其余走内存 store 双 `MemoryKnowledgeStore`——它实现同一 `KnowledgeStore` 接口，接口再长即编译期报错；46 项既有断言逐条保留、用例 46 → 53，新增含「`validate()` 全程不碰存储」的 Proxy 钉、D7 有/无快照两形、reject 类问题不产生修复动作）；新增 `audit-scoring.test.ts` 19 项（**源形状闸**：打分核心零 `fs` import、零 `fs.*` 调用、零 store 构造；另收 `resolveThresholds` 缺省、`scanEntries` 的人口语义、`summarizeIssues` 键集与 label 表闭环、D6/D7 环境数据入参、四档 severity 权重与 fragment-cluster——后两者此前无任何测试）；新增 `tree-walker.test.ts` 6 项（谓词 + **三处对撞同一份条目人口**：同一棵带 `_index.md` / `.snapshots` / `.archive` / `resolutions` 的树，store / migration / index-generator 报出同一集合）；新增 `audit-write-count.test.ts` 2 项（真执行 + `jest.mock('fs')` 记底层写、手法照 `check-read-count.test.ts`：4 条修复 → `index.json` 恰 **1** 次重写、4 个条目文件各 1 次，正对照断言 `autoFixed === 4` 防闸空跑）；`store.test.ts` 加 `applyAll` 8 项 + `getConsumptionStats` 4 项（含「与逐条 `update()` 的落盘结果逐字节相同，只是少重写索引」对撞）；`lifecycle.test.ts` / `reference-tracker.test.ts` 各加一次 stringify 计数项（3 条 → 1 次；**红基线实测 3**，并因此暴露 `mockRestore()` 会清空 `mock.calls`、断言必须落在 try 内）。`knowledge.test.ts` 的 audit describe 因视图层现在会真构造 store（构造即 `mkdir`）而补 ctor 替身（免测试把 `/custom/path` 写到真盘），其对 `KnowledgeAudit` 的接线断言改钉 `toHaveBeenCalledWith(store, { shortContentThreshold: 30 })`。三道闸先红后绿。验收：`npx jest --runInBand --coverage` 167 套件 / **2396 passed** / 6 skipped、覆盖率 **94.29% stmts**（较 #153 的 94.22% 不降；`audit-scoring.ts` 97.88%、`audit.ts` 97.67%（行 100%）、`tree-walker.ts` 100%）、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过（铁律 3/3）、真 CLI 冒烟（`knowledge audit --fix` 3 条修复正常落盘并重建索引；同目录 `knowledge migrate --json` 由 `total 4 / errors 1` 变 `total 3 / errors []`；`knowledge stats` 人口不受 `_index.md` 在场影响）。范围外按票面裁决不动：`store.list()` 每条一次 `findFile()` 线性扫索引的 O(N²)（待实际规模重新量一次再判是否单开票）、`saveAll` 本体、#106 的 mtime+size 索引缓存、lint/doctor/query 自身构造。同型残留记名于 `src/knowledge/CONTEXT.md` 另票评估：`lint.ts` 三处 autoFix 的逐条 `update()`、`recordReference()`（逐事件调用且返回更新后条目并触发回调，批量化会改它的契约）、`ingest.mergeEntries()`。文档：`src/knowledge/CONTEXT.md` 新增三条约定（树排除口径唯一正本、循环内禁止逐条 `store.update()`、审计判定脱离 fs 可测）+ 两个新包内模块条目 + 残留记名；`src/cli/commands/CONTEXT.md` 的 #133「后到者适配」条款改为已适配并记名落点
- fix(cli): `knowledge audit --threshold` 的声明与运行时收口 + 脏输入 fail-loud（#152，#133 搬运时记名的那笔账）——`KnowledgeAuditOptions.threshold` 声明 `number`，而 commander 的 `--threshold <n>`（含缺省 `'50'`）给到的恒是字符串，两处形状相反靠 `parseInt(options.threshold as any, 10)` 躲过编译期（`as any` 把「这旗帜实际是什么形状」从编译器手里拿走，`git log -S` 指向 `4c3577e`）。后果是脏输入 `--threshold abc` → `parseInt` 出 NaN → 引擎侧 `?? 缺省值` 只兜 `null`/`undefined`、NaN 照单全收 → `len < NaN` 恒 false → **短内容判定静默不触发而退出码仍是 0**（端到端实测复现：同一 2 条目知识库，缺省报 `short-content: 1`、`--threshold abc` 报 `0`；`30abc`/`1e2`/`0.7` 亦静默误读）。落地按「声明与运行时一致」判据取窄化在命令模块装配点那一形（knowledge 族是纯投影条目、编组归命令模块，与 `knowledgeSearchCommand` 的 `--limit` 同形；不给 `CommandSubcommand` 补 `mapActionArgs`——那是为通用引擎加单命令知识）：声明改 `threshold?: string`，`assembleShortContentThreshold` 只认「trim 后全数字」→ 非负整数，未传落引擎缺省、显式 `'0'` 不被当未传，转不出来 `logError` + `usage-error`（bin 映射退出码 1，审计与索引重建均不发生）；引擎侧 `audit.ts` 的 `??` 不重复兜（上游已挡）。**对外行为变化 1 处**：脏阈值由「静默少一道判定 + 报告里可能打出『阈值 NaN』」变为报错退 1；命令语法、旗帜集合、`--json` 字段集合、合法取值的输出字节全部不变（非 breaking，判据同 `[1.6.0]` 删 `--max-retries` 那条「静默无效 → 报错」）。测试：新增 `__tests__/knowledge-audit-threshold.test.ts` 17 项（真 KnowledgeAudit，证阈值落进判定而非参数传到——脏值 10 形 fail-loud 且 stdout 零字节、不写盘；未传与显式 `'50'` 逐字同果；`'30'`/`'40'`/`'29'` 边界随入参移动；显式 `'0'` 不被兜掉；`knowledge.ts` 零 `as any`）+ `__tests__/bin-exit-mapping.test.ts` 端到端补一条「脏阈值 → 1」；三道闸先红后绿（红基线：脏输入退 0、字符串实参在 `threshold: number` 下 TS2322 编译不过）。既有面：`knowledge-view.test.ts` 闸 1 的 `kind:` 逐行冻结豁免表随 #152 增第二行（理由随表注，同 search 缺参那条——入参闸门而非投影出口），其余 65 项含 json 字段清单与人读逐行冻结零改动；`public-value-surface`/`public-exports` 三闸零清单改动。同型自查（票面第 3 点，登记不改）：`knowledge.ts` 的 `as any` 归零，本目录其余 7 处（acceptance/contract/performance/security/status）不在数值旗帜装配链上；其余 `<n>`/`<rate>` 旗帜的声明与运行时形状全部一致（`status --hours`、`constraints report` 三阈值、`passes-gate --coverage-threshold`、门禁 `--bundle-threshold`/`--min-reviewers`、`knowledge`/`failure --limit` 均在装配点显式转一次，`failure --limit` 且声明双形），但脏输入的下游后果分两类——fail-closed（coverage 阈值 NaN → 恒判不足；`min-reviewers` NaN → 恒不通过）与静默降级（`--noise-*` NaN 进阈值槽 → 候选静默减少；`--limit` NaN falsy → 落缺省 20/不截断；`--bundle-threshold` NaN falsy → 阈值不生效），另 `status --hours` 转出的数值全仓零消费者（死旗帜，与 `init-dead-options` 同族）。统一收法（装配点抽 fail-loud 的数值旗帜解析器）另票。验收：`npx jest --runInBand` 163 套件 / 2299 passed / 6 skipped、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过（铁律 3/3、指导原则 3/3）、`knowledge.ts` 行覆盖 94.55%（本票新增行全覆盖，未覆盖行 165-170/194-195/518/600-605/611-612/652 均为既有分支）、真 CLI 冒烟（`--threshold abc` 退 1 且无报告 / `--threshold 30` 让 30 字符条目退出判定 / 缺省仍 `阈值 50` / `--threshold 0` 一条不报）。文档：`src/cli/commands/CONTEXT.md` 新增「数值旗帜装配口径」条目
- fix(cli): `init --print-snippets` 的 GitHub Actions 片段由落盘正本裁剪派生（#153，#132 resolution 记名的那处「未动」）——`--print-snippets` 打印的 `GITHUB_ACTIONS_SNIPPET` 是 `HARNESS_CHECK_WORKFLOW` 之外的第二份手抄 YAML：实测 230 字符对 608 字符、steps 只到 `harness check`，比同版本 `harness init` 落盘的 workflow **少 `validate` 与 `passes-gate` 两道门禁**，两份文本之间且无同源闸（连空行与 `- name:` 都各写各的，`HARNESS_CHECK_WORKFLOW.includes(GITHUB_ACTIONS_SNIPPET)` = false）。用户照指引把 job 粘进现有 workflow，得到弱一半的 CI 且无任何提示——这是 #103 判据的第三种形态：不是「打印的文字与落盘的不同」而是「打印的功能上更弱」；同一命令里两种「给你看要写什么」的形状（CI 冲突分支打全文、旗帜打弱片段）也自相矛盾。落地：`scaffold-templates.ts` 删掉手抄常量，改为 `HARNESS_CHECK_WORKFLOW.slice(indexOf('  harness-check:'))`——单一正本 = 落盘的 workflow，片段是它 `jobs:` 段之后的一切（494 字符），形状与 #143 的 GitLab 侧「打印的任务正文是落盘全文的尾巴」对仗；`init.ts` 引导语 `添加到 .github/workflows/*.yml 的 jobs 中` 改为 `添加到 .github/workflows/*.yml 的 jobs 下（以下正文取自 harness-check.yml 的 job 段）`。**不取**「保留弱片段 + 加一行免责标注」那条形（免责行不解决「照抄就少两道 gate」）；若认为片段视图**应当**只装 `check` 一步，那是功能取舍，须回炉重裁、本票未擅自做。**对外行为变化 1 处**（定级判据同 `[1.6.0]` 删 `--max-retries` 与 ADR-0022，发布级别随本车 ship 时裁决）：`--print-snippets` 的 GH 片段正文变长（补 `validate` / `passes-gate` 两个 step、step 带 `- name:`、前导空行由 2 行并为 1 行以对齐 GitLab 段）加引导语改字；命令语法、旗帜集合（`--print-snippets` 保留不删旗）、退出码、**落盘字节**全部不变，迁移路径 = 无需改命令，照旧抄即拿到与 `harness init` 同强度的 CI。测试：三道闸先红后绿——`__tests__/init-ondisk.test.ts` 新增「init --print-snippets 的 GitHub Actions 片段视图」3 项（**同源闸**：打印的 job 正文逐字等于 `harness-check.yml` 字节级冻结基线 `jobs:` 段之后，且是 init 真正落盘那份文件的子串、两处出口的 `run:` 集合相等；**steps 集合闸**：按 YAML 解析枚举 job 的 `run:` 命令而非子串碰运气，须含 `check`/`validate`/`passes-gate`；**引导语逐字冻结**）+ `__tests__/scaffold.test.ts` 的 `#103 判据` describe 加一条「片段视图是落盘正本裁出来的一段」包含闸。反向验闸各红一次并还原现场（sha1 对拍一致）：删正本 `passes-gate` 一步 → 同源闸与 steps 集合闸各红（引导语项按预期仍绿，它是另一根轴）；把打印改回独立手抄 → 包含闸与同源闸同红，即本票开工时的红基线。**同族自查（票体第 4 点）**：`PRE_COMMIT_SNIPPET` 无独立第二份正文——落盘 hook = `#!/bin/sh` + 说明行 + 该常量（`renderPreCommitHook`），冲突分支与片段视图打的都是这同一常量，`init.test.ts`「pre-commit 片段与落盘 hook 同源」与 `scaffold.test.ts`「pre-commit 站点落盘正文 = 打印片段 + shebang 头」「merge 站点全部同源」三条闸在位，本票对它零改动；两处极性相反但各自单份（pre-commit 以片段为原子组合出全文，GH 以全文为正本裁出片段），「单一正本」判据在两站点同时成立。既有冻结面的改动清单：`init-ondisk.test.ts` 的整屏冻结基线与 `init-dead-options.test.ts` 的旗帜面冻结**零行改动**（前者冻结的是不带 `--print-snippets` 的落盘路径，后者冻结旗帜定义表），断言形状未放松。验收：`npx jest --runInBand` 160 套件 / 2270 passed / 6 skipped、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过（铁律 3/3、指导原则 3/3）、覆盖率 94.22% stmts 与 #143 持平且 `scaffold-templates.ts`/`scaffold.ts` 行覆盖 100%（`init.ts` 余下未覆盖行 443-444/449-450/687-688 是本票未触碰的既有分支）、真 CLI 冒烟（`init --print-snippets` 的 GH 段与 `init` 落盘的 `.github/workflows/harness-check.yml` 逐字同源）、`sync-docs --check` 只剩 hooks/knowledge/monitoring/release 四处既有目录漂移。文档：`src/cli/commands/CONTEXT.md` 的 scaffold 条目补记「片段视图由正本裁剪派生」，并新增「同族不同面」子条与 #150（CONTEXT.md 模板双正本，同一判据的另一面：那是两个命令各抄一份，本票是同一命令的两个出口各抄一份）互指，两票不并
- fix(cli): `createContextMd` 改消费 scaffold 正本，消除 CONTEXT.md 模板双份漂移（#150，#132 resolution「顺带发现，未做」①）——#132 按票体口径收了 8 站点（init 6 + validate 2），落地后全仓又查出**第 9 处同形写手**：`src/cli/commands/sync-docs/context-syncer.ts` 的 `createContextMd` 自带一份 CONTEXT.md 模板正文，与 `scaffold-templates.ts` 的 `renderContextDoc`（`:280`）已漂移——节标题（职责 / 核心导出 / 依赖关系 / 注意事项）两边相同、占位正文不同（副本独有「请阅读源代码…」「AI 编码助手…」两行，且占位一处是散文式提问、一处是 HTML 注释形）。同一份骨架由两个命令各抄一份，是 #103/#153「打印的即落盘的」判据的同族另一面（#153 是同一命令两个出口各抄一份，本票是两个命令各抄一份），在 #132 的 8 站点口径外、该票按「一张票就是一张票」未顺手做。落地：副本独有两条引导并入正本、四节占位统一取 HTML 注释形（散文式提问消失）；`createContextMd` 改经 `contextDocFile()` + `runPlan()` 消费正本（带 `io` 形参与注入 `ScaffoldFileSystem`），删除自带模板正文与 `fs.mkdir`/`fs.writeFile`；`sync-docs/index.ts` 调用点删重复绿字——该句与 `contextDocFile.created` 文案逐字同文，收进 `runPlan` 是去重、输出字节不变。**语义不变**：仍只为 `contextMissing` 的目录落盘、走 `created` 分支，`exists`/`manual` 在该判定下不被触发（已在 doc 注明：若被触发说明两命令的在场判定口径不一致，写进票面不静默兜）。**对外行为变化 1 处**：`harness init` 与 `harness sync-docs` 两条路径落盘的 `CONTEXT.md` 骨架正文变了（首行去句号 + 占位由散文式改 HTML 注释形 + 并入两行引导）。定级：非 breaking——变的是**新建文件的注释文本**，命令语法、旗帜集合、退出码、公共导出面零变化，且已持有 `CONTEXT.md` 的项目不受影响（sync-docs 只为缺失目录落盘、在场不覆盖），迁移路径 = 无需迁移。测试：新增 `__tests__/context-syncer.test.ts`（内存 fs 替身，零真实文件系统）——单一正本闸（`grep -rn "此文件描述" src bin` 现仅 `scaffold-templates.ts:284` 一处）、`createContextMd` 落盘字节 == `contextDocFile().content` 对撞、正本文案逐字钉 + 散文式提问 `not.toContain`、seed 后返回 `exists` 且用户正文一字节不动；`sync-docs.test.ts` 既有「应该创建缺失的 CONTEXT.md」仍过；`public-value-surface`/`public-exports`/`public-type-surface` 三闸零清单改动（`renderContextDoc`/`createContextMd` 均不在五入口公开值面上）。验收：`npx jest --runInBand` 161 套件 / 2274 passed / 6 skipped、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过（铁律 3/3、指导原则 3/3）。文档：`src/cli/commands/CONTEXT.md` 的「8 站点的落点」子条追加第 9 处归位说明、「同族不同面」子条把本票由待办改记已落地并注可检面；票体验收 #7 点名的 `src/cli/commands/sync-docs/CONTEXT.md` 实测**不存在**（全仓 src 下 CONTEXT.md 恰 13 个，与 AGENTS.md 计数一致），新建会破 13 计数约定属越界，故补记全部落在父级文件并在票面记名。已知残留另票：上述「对撞断言」是单边自撞（init 侧从不被执行），给正本加一行仍全绿，即「改正本无测试报警」——统一复审 F5，见 #158
- feat(cli): init 的 CI 接线加平台维度——`--ci <github|gitlab|none>` 与 `.gitlab-ci.yml` 落盘（#143，#132 曝光的已知缺口）——harness 的约束要成立必须抢到「合并前」这个服务端执行时机：本地 hook 跑在推送者控制的机器上（`--no-verify` 可绕过、`.git/hooks` 不进仓库）只能算自检，而 init 的 CI 面此前只懂 GitHub Actions（harness-check workflow / `-g` 档治理 workflow / `--print-snippets` 三处全是 GH 形状），自建 GitLab 用户零 scaffold 支持。落地（决议 ①–⑥，正本见 `src/cli/commands/CONTEXT.md`）：`types/project-config.ts` 新增 `CiPlatform`（`github`/`gitlab`）与 `CiConfig` + `ProjectConfig.ci`；`scaffold-templates.ts` 新增 `GITLAB_CI_SNIPPET`（harness-check 任务正文，`--print-snippets` 与冲突分支共用）、`renderGitLabCiJobs`、`renderGitLabCiFile`（= 文件头 + harness 拥有的任务），`renderGovernanceWorkflow(level, platform)` 按平台出 GH workflow 或 GitLab 任务（治理档的 `sync-docs --check` 非阻断在 GitLab 侧对应单列 `harness-docs-freshness` 任务 + `allow_failure: true`，因每个任务都是全新容器）；`scaffold.ts` 的 CI 站点工厂收口成 `harnessCheckCiFile(projectPath, platform, existingCiWorkflows, governanceLevel?)`——github 形（含冲突清单与文案）逐字节不动，gitlab 形目标 `.gitlab-ci.yml`、冲突面即 target 自身、三态 `created`/`manual`，打印的任务正文是落盘全文的尾巴（#103 判据）；`init.ts` 新增解析链 flag > config.yml `ci.platform` > `github`（`resolveCiPlatform` / `readConfiguredCiPlatform`，脏配置按未配置）并把平台选择贯通三个面，`setupGitHubActions`→`setupCiWiring`、治理站 `setupGovernanceWorkflow` 加平台入参。**按决议不建 CiPlatform 注册表/通用抽象**（第三平台出现再提），**不做 remote URL 自动检测**。**三处对外行为变化**（是否记 breaking 由本车 ship 时裁决，判据同 `[1.6.0]`/`[1.7.0]`）：① `--no-github-actions` 降为 `--ci none` 的别名，改用即黄字 deprecation 警告，且它现在把 `ci.platform: none` 写进 config.yml（此前无痕），迁移路径 = 换成 `--ci none`；② `--ci` 非法值、以及 `--ci <非 none>` 与 `--no-github-actions` 同时给出，判 `usage-error` 退出 1 且完全不落盘（此前无从属关系）；③ 非默认平台才写 `ci.platform` 键——`github` 不写键而 init 每次重写 config.yml，故「不写」即清除，旧配置零迁移、`validate` 不因此报错。有意保留的现状：`none` 只摘掉 harness-check 站点（`-g` 档照建 GH 治理 workflow、`--print-snippets` 照出 GH 片段，即今天 `--no-github-actions` 的行为），切回 `github` 时不删既有的 `.gitlab-ci.yml`（scaffold 只有落盘/告知两种动作）。测试：`__tests__/scaffold.test.ts` 新增「CI 站点的平台维度」7 项（目标路径 / 三态文案逐字冻结 / 冲突面按平台分岔 / 与 GH 对仗的命令与 `rules:` 面 / 治理并入 / 落盘正文是合法 YAML）并把同源闸扩到两平台四形（另 2 项）；`__tests__/init-ondisk.test.ts` 新增「init --ci 平台维度」8 项（`.gitlab-ci.yml` 逐字节两档 + 第二趟 manual 且用户正文一字节不动 + 持久化回读让裸 init 与 `--print-snippets` 都按 gitlab 出面 + `none`/别名/冲突/非法值 + 脏 `ci` 段回落）；`__tests__/init-dead-options.test.ts` 的旗帜面冻结随 `--ci <platform>` 更新。反向验闸七处各红一次并还原现场：删 `allow_failure: true`（红 3 项）、冲突分支片段改为整份正文（红同源闸）、解析链去掉 config 回落（红持久化回读）、持久化写成恒 `github`（红 3 项）、冲突判定条件反转（红冲突项）、去掉非法值校验（红非法值项）、`ci` 段读取不兜 YAML 解析失败（红脏配置回落项）。验收：`npx jest --runInBand` 160 套件 / 2266 passed / 6 skipped、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过、覆盖率 94.22% stmts 且 `scaffold-templates.ts`/`scaffold.ts` 行覆盖 100%（`init.ts` 余下未覆盖行 444-445/450-451/688-689 是本票未触碰的既有分支）、真 CLI 冒烟（`--ci gitlab -g standard` 落盘全文、重跑 manual、`--ci bitbucket` 与 `--ci gitlab --no-github-actions` 退 1、`--print-snippets` 按 config 出 GitLab 片段、`--ci github` 清掉 `ci` 段并回到 GH 形状、全新目录裸 init 输出逐字节不变）。文档：`src/cli/commands/CONTEXT.md` 的 CI 平台维度条目由「grilling 落定待实施」改为已落地并记名两处形状差。已知缺口按决议另开票，本票不做：pre-push hook #144、CI 缓存（两家一起加）、remote URL 自动检测、删除 `--no-github-actions`（属下个大版本）
- refactor(cli): knowledge 11 子操作的两份手抄投影收成一次分派（#133，架构评审候选4）——`knowledge.ts` 的每个子操作原先同时干「取数 + json 投影 + 人读排版 + 退出码」四件事，同一个数据两处落地、字段名靠人对齐（17 处 `options.json` 分支、8 处 `new KnowledgeStore`、95 处 `log(io, …)`），给 `--json` 加字段没有报警。落地：新增 `knowledge-view.ts` 收口 json/人读唯一分派与退出码（`emitKnowledgeView`）、取数期进度行（`announce`，`--json` 下静默）、角色→样式单表（`TONE_STYLES`，命令侧零 `chalk`）、维度/规则 label 与成熟度/分数/严重度三张映射、路径兜底与 store 构造单点（`resolveKnowledgeBaseDir`/`openKnowledgeStore`）；命令模块只产 `{ data, human() }`（11 个 `knowledgeXxxView` 具名导出即投影本体，`data` 是 `--json` 正文唯一正本）。术语 **display model**：`human()` 返回 `{ sections: [{ title, rows: [{ cells }] }] }`，一格三选一——`label`（纯文案）/ `field`（点分路径声明投影自 json 面哪个字段，数组下标与 `.length` 合法）/ `derived`（json 面没有的派生量，须在豁免表登记理由）；空行改为显式一行，不再靠 `\n` 前后缀藏排版。**json 面按决策现状冻结**：11 个顶层形状逐字不动（`knowledge --json` 双仓核实零程序化消费者，studio 走 library 直调；统一包壳是纯 churn，删 `--json` 死面按 ADR-0022 口径另票评估）。三处有意偏离，均不改字段集合：① `snapshot`/`index` 的 `--json` 由单行紧凑改为两空格缩进（分派单点化的直接结果，与其余 9 个同形）；② `sync-rag` 两个空态此前把人类文案直接打到 `--json` 的 stdout（吐出的不是 JSON），现由 display model 承担、json 面恒为 `{directory, files}`——正是「两投影各写一遍会漂」的实证；③ `stats` 人读面 `verified` 的颜色随 `toneForMaturity` 单表变青色（此前 list 青 / stats 黄两处手抄不一致，文字逐字不变）。测试：新增 `__tests__/knowledge-view.test.ts` 66 项四道闸——源形状闸（`knowledge.ts` 零 chalk/store 构造/JSON.stringify，`if (options.json)` 只余 audit 索引重建一行豁免并逐行冻结；view 模块 store 构造与 JSON.stringify 各恰好一处、`chalk.` 只准出现在样式表里）、11/11 json 字段清单冻结（含 `entries[0]`/`summary`/`dimensions` 等嵌套层）、两投影一致性（display model 声明的 `field` 必须在真实 `--json` 输出里解析得到 + `derived` 双向对撞登记表防化石）、满态与**空态**人读输出逐行冻结（两份基线均取自改造前实现实测捕获，非凭记忆）。反向验闸各红一次并还原现场：把 `derived` 谎报成 `field`（红在一致性闸两条）、向 `knowledge.ts` 注入第二处 `JSON.stringify`（红在源形状闸）、人读文案改一个字（红在人读冻结）、json 面多一个键（红在字段清单）。`knowledge.test.ts` 的 `MOCK_REPORT` 标注成 `AuditReport`——7 维度/14 规则键改由编译期穷尽性管住，原先手写 6 键再 splice `incremental` 的缺键补偿写不出来（#109 的编译期闭环不再被 mock 绕开），既有 20 条用例逐条保留、断言不降。`registry.test.ts` 的懒加载探针登记项按新增行扩一条（`knowledge-view.js` 随命令模块一并懒加载，per-command 懒加载不变式仍成立）。行覆盖与 `npm test` 全绿；非 breaking：命令语法、退出码、字段集合、公共导出面零变化。文档：`src/cli/commands/CONTEXT.md` 收口模型条目由「grilling 落定待实施」改为已落地并记名三处偏离。与 #134（KnowledgeAudit 收 store）唯一交点是 `knowledgeAudit` 命令函数，后到者适配
- refactor(cli): init/validate 的脚手架三态判定收口成 scaffold 模块（#132，架构评审候选3）——`init.ts` 922 行里混着「目标在不在场→写或告知」的同一判定 6 处、`validate.ts` 另抄 2 处，且 `init.ts` 反向 import `validate.ts` 取那两个站点函数，改一条落盘语义要动三处、两处的在场文案已经各写各的。落地：新增 `src/cli/commands/scaffold.ts`（三态 `created`（不在场→落盘）/ `exists`（在场→告知跳过，**不细分内容是否等于模板**——内容比较是独立特性）/ `manual`（在场→打印片段请用户手工合并）+ 8 个 `ManagedFile` 站点工厂 + `runPlan`，fs 走 `ScaffoldFileSystem` 注入端口，缺省 node 实现）与 `scaffold-templates.ts`（模板正文，按决议留代码内、不落 `templates/`——该目录无运行时消费者且 `release/integrity.ts` 的 dist 清单不覆盖）；`init.ts` 只留「前置告知 + plan 列表 + 循环」，`validate.ts` 退化到验证本体。行数：`init.ts` 922→619（-303）、`validate.ts` 208→105。边收口边删掉两条反向依赖：`init → validate` 的 import 删除，新增 `init → scaffold` 与 `validate → scaffold-templates`（检查点路径约定单一正本）。**决议边界**：scaffold 不持覆盖/跳过策略——`--no-git-hooks` / `--no-github-actions` 由命令层翻成 plan 里有无该站点，scaffold 只见 plan；标记化幂等写族（`CLAUDE.md`/`AGENTS.md` 治理段读-改-写）不纳入本模块。**两处对外行为变化**：① 死选项 `-t/--type` 删除（自始只有定义表一条与 `InitOptions.type` 一个字段、全仓零读取方），`harness init -t x` 由静默接受变为 commander `unknown option` exit 1，迁移路径 = 去掉该参数；② GH Actions 站点的冲突分支由打印 job 片段改为打印完整 workflow 全文——打印的即落盘的（#103 判据），`--print-snippets` 的 job 片段视图未动。是否记 breaking 由本车 ship 时裁决，判据同 `[1.6.0]` 删 `--max-retries` 那条。测试：新增 `__tests__/scaffold.test.ts`（内存 fs 替身零真实文件系统测全三态 + 建目录/`chmod`/上色路由 + 8 站点 × 落盘态/在场态文案逐字冻结 + 同源闸）、`__tests__/init-ondisk.test.ts`（不 mock 任何 IO，改造前从当前 HEAD 实抓 `harness init` 整屏输出冻结为第一遍断言，第二遍在临时目录跑在场态——7 站点按 init 落盘顺序断言，第 8 站点（治理 CI）在无 `--no-github-actions` 冲突的场景另例断言）、`__tests__/init-dead-options.test.ts`（逐字冻结 init 旗帜面不含 `--type` + 编译期钉 `InitOptions.type` 不存在，防换命令位复活）；`init.test.ts` 新增两例钉跳过旗帜归属边界；`validate.test.ts` 原 4 例由 scaffold 的 8 站点×三态覆盖等价承接。反证已做实：把落盘 hook 正文改掉而不动打印片段 → `merge 站点全部同源` 与 `pre-commit 站点落盘正文 = 打印片段 + shebang 头` 两条转红（改后还原）。验收：`npx jest --runInBand` 159 套件 / 2183 passed / 6 skipped、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过、覆盖率 92.03% stmts 且 `scaffold.ts`/`scaffold-templates.ts` 行覆盖 100%。文档：`src/cli/commands/CONTEXT.md` 的 scaffold 三态模型条目由「grilling 落定待实施」改为已落地。已知缺口按决议另开票，本票不做：GitLab CI 接线 #143、pre-push hook #144、第 9 处模板副本 `sync-docs/context-syncer.ts:createContextMd`（与 `scaffold-templates.ts` 的 `renderContextDoc` 正文已漂移）#150、治理段三 writer 调用丢 io #149
- test(exports): 子路径入口值面全量冻结闸（#131，ADR-0022 追记第 5 条收口）——新增 `src/__tests__/public-value-surface.test.ts`，补齐 `public-type-surface.test.ts` 的另一半：类型面已按 `package.json` 的 `exports` 逐入口冻结，值面却只有包根被 `public-exports.test.ts` 钉住（`Object.keys` 只看得到 `.`），「这个函数不在公开面上、删它非 breaking」在子路径入口仍无闸可跑。四个子路径（`./core`/`./presets`/`./context`/`./gates`）的运行时导出键集合逐入口冻结、入口清单同样从 `exports` 派生（新增子路径未登记即红）；包根不重复钉（同一入口两份清单必然漂移，那条判定逐字保留），「两边都不漏」由登记闸 + 委派闸钉住。清单不手抄：`src` 侧 ts-jest 运行时键与 tsc 产物逐入口对撞，106/29/4/4/24 全部逐字一致。**落闸前实测校正了本票票面的前提**：删 `./gates` 的 `create*Gate` 其实会红（`src/index.ts` 经该 barrel 再导出），只是红名报 `.` 分不清入口；真正零覆盖的是包根未转发的 `./core` 七个（`ConstraintChecker`/`ProjectConfigLoader`/`constraintChecker`/`getCapabilitiesMode`/`getGovernanceConfig`/`loadRawProjectConfig`/`resolveContextFiles`）与 `./presets` 全部四个（实测删 `STRICT_PRESET` 时既有三道公共面闸全绿），新增方向四个子路径都漏。反向验闸四例各红一次且指名到入口与符号：删 `./gates` 的 `createReviewGate`、向 `./gates` 注入 `createScratchGate`、删 `./presets` 的 `STRICT_PRESET`、`package.json` 新增 `./monitoring` 子路径；另测类型面改动（注 `export type { DynamicTask }` 令 `public-exports.test.ts` TS2578「failed to run」）不连带抹掉本闸；每次注入后按 sha1 还原现场。文档：ADR-0022 追记第 5 条改判已收口、`src/gates/CONTEXT.md` 记账。非 breaking：纯测试 + 文档，零生产代码改动、零公共面变化。验收：`npx jest --runInBand` 全绿、`tsc --noEmit` 与 `eslint src` 零错

## [1.7.0] - 2026-09-09

### Changes
> **发布级别裁决（2026-09-09，本车 = 1.7.0）**：本车含 breaking——包根公开类型 `DynamicTask` 删除（二次复审 B1，commit `b2c7b71`）。按人类裁决以 **1.7.0（minor）** 发布，沿用 ADR-0022 决策 4 与本文件 `[1.6.0]` 裁决段的同一判据（本包唯一消费者为 studio，采纳由 ship-chain 阶段 2 显式 bump 完成），不升 2.0.0。代价记档：breaking 内容继续落在 `^1.x` 可解析范围内，任何按范围解析的新增安装都会拿到它；`DynamicTask` 自初版起就在包根类型面，1.7.0 起消失，迁移路径 = 删引用。
>
> **定级纠正（本车的前提变更）**：二次复审原判据「`DynamicTask` 不在包根导出面、故非 breaking」不成立——实测 v1.6.0 源 `src/index.ts:106` 与已发布 npm 产物 `dist/index.d.ts:38` 均含包根 `export type { … DynamicTask … } from './types/passes-gate'`（1.4.0/1.5.0 产物同样在）；且它同时经 `./core` 子入口可达（`src/core/index.ts` 与产物 `dist/core/index.d.ts` 均含）。它是**公开的**死亡类型，两个入口都是。
>
> **流程洞收口（本车已落闸）**：本仓 breaking 定级长期挂在「在不在包根导出面」这个断言上（ADR-0010/0019/0022 皆以它定级），而 `public-exports.test.ts` 的全量冻结只覆盖包根运行时导出面，类型面自 A2 起只有「已删类型」负钉 + 两条活类型正钉——钉的都是删完之后；删除动作之前那句「在不在公开面上」无任何闸可跑，全靠人 grep 记忆，A2 与 B1 已在同一处错两次。本车补 `src/__tests__/public-type-surface.test.ts` 收口：公开面按 `package.json` 的 `exports` 定义（五个入口点，清单从 `exports` 派生，新增子路径未登记即红），类型面全量清单逐字冻结，另有导出写法白名单闸堵 `export *` 与入口内联类型声明。清单来源经 tsc 产物对撞（152/32/1/12/18 逐字一致），非手抄。剩余边界：子路径入口的**值面**仍无对等冻结闸，已记 ADR-0022 追记第 5 条待另案。
- test(exports): 已发布类型面全量冻结闸（ADR-0022 追记第 4 条收口，随本车附带）——新增 `src/__tests__/public-type-surface.test.ts`，把「这个符号在不在公开面上」从人 grep 记忆变成跑一下就有答案的事实。入口点清单从 `package.json` 的 `exports` **派生**而非硬编码（`.`/`./core`/`./presets`/`./context`/`./gates` 五个，新增子路径未登记冻结清单即红），逐入口冻结类型面全量清单 152/32/1/12/18 项；另设导出写法白名单闸堵 `export *` / `export type *` / 入口内联 `export interface|type|enum|class`（这些写法会让按名字扫描静默漏算，正是本病因的形态来源），内联 `export function|const` 属值面放行。**本闸刻意不 import 任何入口**：`public-exports.test.ts` 的编译期钉在类型面被改动时会让整套 suite「failed to run」（实测注入一条 `export type { DynamicTask }` 得 0 tests），拿不到指名到符号与入口的清单 diff，故单独立一个文件。清单不手抄——与 tsc 产物（各 `exports[*].types` 指向的 `.d.ts`）逐项对撞才得逐字一致，并据此抓到 `src/gates/index.ts` 的 3 个 `export { 值, type X }` 混用说明符被「按块分类」漏计（15 → 真实 18），清单归类遂改为按**说明符自身**。反向验闸五种破坏各红一次且 suite 仍跑得动：包根重新导出 `DynamicTask`、`./gates` 删活类型 `GateResult`、包根注入 `export *`、入口注入内联 `export interface`、`package.json` 新增 `./monitoring` 子路径；每次注入后按 sha1 还原现场。非 breaking：纯测试 + 测试文件头注释，零生产代码改动、零公共面变化。验收：`npx jest --runInBand` 151 套件 / 2090 passed / 6 skipped、退出码 0（注：本机 3.6G 内存下并行 worker 会被 OOM 杀掉，`npm test` 退 143，HEAD 基线同样 143，与本改动无关，故取 runInBand 口径）、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过 (1 条) + skip 1 条
- refactor(types,core)!: 删除死类型 `DynamicTask` 与其唯一残留形参（二次复审 B1，ADR-0022 追记）——#104/ADR-0022 删除链的第三处同型漏收，与同案的 `PassesGateResult`（评审 A2）同判据。`DynamicTask` 是已删 `setPasses(taskId, workDir, task?)` 的入参形状，承载「`task.passes` 只能由测试结果修改」的回写语义；该语义经 ADR-0022 判双仓零消费者、ADR-0014 记录 studio 只走 `check()`，后继形状即同文件保留的 `check(testResult: TestResult)`——不变式住在 `check()`，不依赖 `DynamicTask`。消费者消失链非本次新制造：f7facf3（#104）删 `runAllTests`/`checkAllPasses` → 9e62a67（ADR-0022/#125）删 `setPasses`/`getTestResult`/私有 `testResults` 缓存，此后全仓只剩私有 `runTest` 那个从不读取的 `_task` 形参在供养它、唯一调用点显式传 `undefined`。归属判定按 `no_delete_without_context` 走完全程：「未接线→接线」不成立（等于复活被 ADR-0022 明确推翻的 seam）、「被替代→吸收模式」已完成 → 真正无用，删。收口面：接口本体 + 四级 barrel（`types/passes-gate` → `core/validators/index` → `core/index` → `src/index`）+ 未读 `_task` 形参（`runTest` 签名收为 `(workDir, command?)`，唯一调用点随之改）。测试：`public-exports.test.ts` 的类型面闸扩为「同链已删类型」清单（四级链扫描收为共享 helper，逐类型各一条 `@ts-expect-error` 编译期钉），先红后绿（加钉未删时红在 TS2578）+ 反向验闸（向 `src/index.ts` 注回该字样即「四级链都已消失」红，还原后 sha1 回到注入前值）。文档：`src/core/CONTEXT.md` 记账；`docs/public-exports-review.md` 是 2026-08-19 历史评审快照，按 ADR-0022 决策 4 不回改。studio 侧 `apps/`+`packages/` 零命中，双仓零消费者成立。按 1.7.0 发布（breaking 级别裁决见本节首）。验收：`npm test` 5 套件 64 项绿（改动面相关）、`tsc --noEmit` 与 `eslint src` 零错

## [1.6.0] - 2026-09-09

### Changes

> **发布级别裁决（2026-09-09）**：本车含 breaking（ADR-0017/0018/0019/0022 的公共面删除 + 评审 A1/A2 追加的死旗帜与死类型），按人类裁决以 **1.6.0（minor）** 发布，推翻各 ADR 原「影响版本：下个 major（2.0.0）」判定（措辞已就地改写并保留被推翻痕迹）。依据：本包唯一消费者为 studio，采纳由 ship-chain 阶段 2 显式 bump 完成，`monitor-system-probes` 调用点随 studio#459（`32e34b39`）同批部署翻转。代价记档：breaking 内容落在 `^1.x` 可解析范围内，任何按范围解析的新增安装都会拿到它。
>
> **本条是事后补记**：它随 `[Unreleased]` 一起写就，发版时被 `harness-ship` 的 CHANGELOG 迁移逻辑（只保留 `-` 开头行）静默丢弃，并已随 v1.6.0 tarball 与 GitHub Release 发布出去、无法回收。丢弃缺陷已在部署工具侧修复（`studio-config` 的 `bin/lib/changelog_release.py`：非 bullet 实质行随条目一并上移 + 内容守恒 fail-loud 断言）。
- refactor(cli,core,types)!: 独立评审 A1/A2 收口——删 `passes-gate` 的死旗帜与死类型（#122/#125 删除动作的直接遗留）：① `--max-retries <n>` CLI 旗帜 + `PassesGateConfig.maxRetries`/`retryDelay` 字段 + 其默认值与装配赋值——重试实现原住已删的 `setPasses`，删后整条装配链只剩写入方、无任何读取方，`harness passes-gate --max-retries N` 恒不生效（同 ADR-0018 删 performance 幽灵旗帜的判据）；② `PassesGateResult` 类型（已删 `setPasses` 的返回形状，`attempts` 字段全仓零赋值方）及其四级 barrel 转发链 `types/passes-gate → core/validators/index → core/index → src/index`，包根类型面收缩——此为 #125 票面「关联类型导出随迁」的漏收项，`public-exports.test.ts` 只冻结运行时导出、类型面无对等闸，故无测试可捕获。对外行为变化：`--max-retries` 由静默无效变为 commander `unknown option` exit 1，迁移路径 = 去掉该参数（studio 全仓零调用方，实测 grep）。测试：新增 `passes-gate-dead-options.test.ts` 与 A2 的导出面钉桩先红后绿，反向验证「把 `PassesGateResult` 加回 `src/index.ts` 即套件红（TS2578）」证明新闸非空洞。按 1.6.0 发布（breaking 级别裁决见本节首）。验收：`npm test` 150 套件 / 2073 passed / 6 skipped、`tsc --noEmit` 与 `eslint src` 零错、`node bin/harness.js check` 通过（主会话独立复跑核对）
- refactor(core,context,knowledge)!: 零消费者公共面收缩——六项删除（ADR-0022，架构评审候选6）——六项公共导出符号经 harness+studio 双仓核实零生产消费者，按 #104 判据删除，不留兼容 shim：① `PassesGate.setPasses`/`getTestResult`/`checkTestFileChanges`（studio 只走 `check()`、harness 只走 `runTests()`）连带死数据 `PROTECTED_TEST_PATTERNS`（`.some(() => …)` 回调丢弃模式参数、真实匹配靠硬编码 includes）与只被 setPasses 写、只被 getTestResult 读的私有 `testResults` 缓存；② `SessionStartup` + `createSessionStartup` + `DEFAULT_CODE_CHECKPOINTS`/`MINIMAL_CHECKPOINTS`；③ `CleanStateManager` + `createCleanStateManager`；④ `AdaptiveTokenBudget`（`TokenBudget` 基类不动）；⑤ `SessionCompaction` + `DEFAULT_COMPACTION_CONFIG`；⑥ `KnowledgeLifecycleHooks`。删除面另有 `src/core/session/` 整目录、`src/types/session.ts`（其全部导出都在删除集内、删后无任何剩余消费者）、`src/context/compaction.ts`、`src/knowledge/lifecycle-hooks.ts`、`context/types.ts` 的 `DEFAULT_COMPACTION_CONFIG` 定义段，barrel 链三级同删（子目录 index → `core/index` → `src/index`）；关联类型随迁 `StartupCheckpoints`/`StartupCheckpointType`/`StartupCheckpointResult`/`CleanStateConfig`/`CleanStateResult`/`DetectedBug`/`TaskListJson`/`TaskStepStatus`/`SessionInfo`/`CompactionResult`；包根运行时符号 10 个消失，`public-exports.test.ts` 清单逐条同步（diff 即评审材料）。**不删两项**：`ErrorClassifier`（studio `diagnostics.routes.ts` 真实消费）、`CSOValidator`（studio 名义消费，端点存废属 studio 侧另票）；`CompactionConfig`/`CompactionLevel` 也不随引擎删——`CompactionLevel` 仍被在用类型 `ContextUsageSnapshot.compactionLevel` 引用，而两者不在 ADR 的双仓核实清单内，未经核实不扩权删除（记名留待复核）。历史 AC-007「保留 `setPasses()` 向后兼容」被本 ADR 明确推翻（兼容对象不存在），改写为编译期 `@ts-expect-error` + 运行期原型双重钉新形状。测试随迁删除：六符号自有测试（含 `session-startup` 的两份重复文件）与 `passes-gate-extra.test.ts`（残留只是一个无断言 `it.skip` 占位）；`passes-gate.test.ts` 三处以 setPasses 为观测窗的用例改从现存生产路径观测（探测 fail-closed 双路径→runTests 单路径、harness#94「结果面无 coverage」钉子改由 `runTests()` 承住），`token-budget.test.ts` 删 AdaptiveTokenBudget 段。文档：`core/CONTEXT.md`（职责与 `session/` 导出条目消失、PassesGate 公开面记为 `check()`+`runTests()`、git 取证链外豁免清单删掉 `session/clean-state.ts`/`session/startup.ts` 两站点并把 `passes-gate.ts` 的 `git diff --name-only` 改为已消失项）、`context/CONTEXT.md`（压缩只剩词汇不留引擎）、`knowledge/CONTEXT.md`（导出一条 + 对 `src/context/` 的依赖声明随 lifecycle-hooks.ts 删除而收正）；`docs/public-exports-review.md` 是 2026-08-19 历史评审快照，按 ADR 不回改。迁移路径 = 删引用（双仓已核实无引用）。按 1.6.0 发布（与 ADR-0017/0018/0019 同车；breaking 级别裁决见本节首）。验收：`npm test` 149 套件 / 2063 项绿、`tsc --noEmit` 与 `eslint src` 零错、行覆盖 91.87%、`node bin/harness.js check --staged`（复现前置有二：① 变更集非空，即带本票暂存的 29 个文件，触发条件并集 `module_modification, code_implementation`；② 该工程已有验证证据——`no_completion_without_verification` 读 `.harness` 运行时证据，裸检出无证据时判违规而非下列数字）→ 铁律全部通过 (3 条) + 指导原则 3/3 + skip 3 条（`incremental_progress`/`context_doc_sync`/`governance_presence`），已在 #125 自身改动集上以独立 worktree 复核；同一命令在干净工作区直跑（无变更集）得的是触发 `file_modification` → 铁律全部通过 (1 条) + 指导原则 0/0 + skip 1 条（`governance_presence`）。原句只写了带改动运行的数字却没写这两个前置，按字面不可对外复现，此处补全口径（review A3）
- refactor(core): git 取证 seam 名义收窄为「check 链路唯一」+ spec/validator 同型收口（ADR-0021，架构评审候选5）——`git-evidence.ts:4` 自称「全仓唯一的 git 取证点」、`core/CONTEXT.md:28` 禁令字面只盖 `execSync('git …')`，实况是 7 个生产文件约 18 条 git 命令不走 seam（多数用 `execAsync`/`execFileAsync`）：名义与实况两层皮，且错误名义会被新人照抄。落地三件：① 约定改写为「check 链路（context-builder / checker / CheckEnv / validators）的 git 事实经 adapter」，禁令字面覆盖三个 exec 出口，`CONTEXT.md` 导出段与 `git-evidence.ts` 头两处自我声明同步；② 五组链外站点**记名豁免**并逐条带理由（`session/clean-state.ts` git add/commit 是**写**操作不属取证、`cli/commands/release.ts` 发布编排非判定证据、`gates/review.ts` + `cli/commands/review.ts` PR 审查流 gh/日志语义、`session/startup.ts` 启动摘要容忍降级、`knowledge/import.ts` 导入启发式失败记 ImportError 降级）——不选全量收口（语义异质，硬塞会造出宽 interface），也不选纯文档降级（浪费真同型站点）；③ 收口唯一同型站点 `core/spec/validator.ts` 的 `git diff --cached --name-only` → 就地 `createGitEvidence(cwd, run?)` + `splitFileNames`，取证根按 #95 约定锚到 projectPath（原 `execAsync` 不带 cwd → `-p X --staged` 列的是 cwd 的暂存区、校验的也是 cwd 的文件，与打印的「项目路径: X」无关，是假绿形状），返回名随取证根 `path.resolve(cwd, …)` 与非 staged 分支的 glob `absolute:true` 同口径。`validators/passes-gate.ts:414` 本票不动——随 ADR-0022 删 `checkTestFileChanges` 消失，CONTEXT.md 如实记名为待消失项、不列豁免。按 minor 发布，不并入本车的 breaking 集合：公共导出与类型零变化，`SpecValidator` 公开签名逐字不变（`getStagedFiles` 是包内 private）；行为面唯一可见变化 = `spec --staged` 结果 `file` 由相对名变绝对路径。测试：`getStagedFiles()` 两枚用例先红后绿（注入 `GitCommandRunner` 钉住命令字面量与取证目录、runner 抛错降级空列表），validator 套件 38 项与全量 156 套件 / `tsc` / `eslint` 绿
- refactor(monitoring): `TraceAnalyzer` 的 `summarize`/`detectAnomalies` 判定本体下放为 `trace-analyzer.ts` 的模块级纯函数 `summarizeTraces(traces)` / `detectTraceAnomalies(summaries, config?)`，类壳保留并转发（ADR-0020，架构评审候选4）——两个纯数据进出的判定挂在有状态类上，逼消费端付构造与 mock 成本：`status` 为调它们必须 `new TraceCollector({traceFile})`（构造函数带 `ensureDirectory()` 的 mkdir 副作用，而该路径的读方法从未被调用，实例仅作构造参数）+ `new TraceAnalyzer(c)`，测试端 `status.test.ts`/`status-extra.test.ts` 合计 18 处 mockImplementation 才能断言。落地：`src/cli/commands/status.ts` 直调纯函数，构造仪式与 mkdir 副作用退出该路径，两套件删掉 TraceAnalyzer/TraceCollector mock（fs/chalk 分层 mock 按需保留）改喂合法 trace 行断言真实输出。不动面：`compareWithPrevious`/`generateReport`/`analyzeRecent*`/`analyzeConstraint`/`saveSummary`/`runHourly*` 保持类方法，`TraceAnalyzer` 类壳签名逐字不变——studio 是**运行时**消费者（`runtime.ts:70` `new TraceAnalyzer(c)` + 路由调 `analyzeRecentReport`/`detectAnomalies`），保留类壳使本票为纯内部重构、零跨仓协调。公开面零变化：两纯函数不进包根导出（ADR-0003 零扩张），仓内经相对 import；按 minor 发布，不并入本车的 breaking 集合。测试：模块级两枚直调用例（钉住纯函数 interface：skip 不进分母、阈值经参数传入）+ `__tests__/status-analysis-wiring.test.ts` 接线闸（源形状 + 真实工程根行为）先红后绿
- refactor(cli)!: `update-user-model` / `analyze-sessions` / `src/cli/session-mining/` 迁出公开包（ADR-0019，架构评审候选3）——两命令是个人环境挖掘工具：默认数据源硬编码 `~/.claude/projects/-root--claude`、画像写 `-root-projects/memory/user_profile.md`（#116 的 env 覆盖 seam 只整理了行李，没回答「该不该住这」），违 `src/CONTEXT.md` 自订的「公共包，禁止硬编码业务路径」；按 #110 同型判例（knowledge upsert/sync-status 迁 studio）整锅迁出、不留命令名占位。删除面：`src/cli/commands/update-user-model.ts`（476 行）、`analyze-sessions.ts`（335 行）、`src/cli/session-mining/` 整目录（transcript/corrections/text/index + transcript 测试；仓内消费者只有这两条命令，符号零包根导出）、`definitions.ts` 两条路由（含别名 `uum`/`analyze`）、两命令自有测试、`utils/__tests__/jsonl-skip-disposition.test.ts` 对 `transcript.ts` 的 skip 读点冻结条目。顶层命令面 23→21，`CAPABILITIES.md`（含计数，经 sync-docs）、`cli/commands/CONTEXT.md`、README、CLAUDE.md 同步。承接方 = studio CLI（studio#459：`studio update-user-model` / `studio analyze-sessions`，session-mining 代码随迁，monitor-system-probes 调用点改走 studio 自家 CLI），迁移路径即改调 studio 命令，state 文件路径口径不变。按 1.6.0 发布（与 ADR-0017/0018 同车；breaking 级别裁决见本节首）。测试：registry 命令清单与 skip 冻结表两道闸先红后绿（「读点消失却不删条目也失败」那条闸据此同步收口）
- refactor(gates,cli)!: performance 门禁维度删薄——只执法有真实现的维度（ADR-0018，架构评审候选2）——responseTime/memoryUsage 两维原用 `Math.random()` 伪造指标并据此判负（门禁报告写着并不存在的测量值），runBenchmark 真实现从未被 check() 调用且语义可疑（量 harness 进程自己的 heap），两维加 minThroughput 零真实消费者（studio 零引用、registry 无阈值、context 无人设置）。删除：`PerformanceThresholds.maxResponseTime/.maxMemoryUsage/.minThroughput`、`PerformanceGateConfig.benchmarkCommand/warmupRuns/measureRuns`、`GateContext.benchmarkCommand`、`runBenchmark/singleBenchmark`、`benchmarkTimeout`、CLI `--benchmark/--benchmark-timeout`——门禁只剩 coverage（json-summary）与 bundleSize（dist 测量）两个真维度，按 1.6.0 发布（与 ADR-0017 同车；breaking 级别裁决见本节首）。顺手修 CLI 字段错位（`thresholds.coverage`→`minCoverage`、bundleSize 字节错位→KB 直传、幽灵 context 字段与 benchmarkTime 显示删除、打包大小显示单位修正）——`harness performance --coverage-threshold/--bundle-threshold` 从此真正生效（此前恒绿「无指标」）。测试：CLI 两枚红灯先写后绿，gate 侧 coverage/bundle 行为用例全保留
- refactor(failure,core,cli)!: 约束收集语义归宿 checker，删除 ConstraintViolationHandler 三策略模块（ADR-0017，架构评审候选1）——COLLECT 策略在唯一生产路径 `harness report` 上制造假绿（checker 首个铁律违规即 throw，handler 的 catch 丢弃 `error.result` 合成空结果 → 违规报成零、passed=全量），且 `ConstraintViolationError.result` 是单条 `ConstraintResult` 而非完整结果，「收集所有违规不抛出」对真实 checker 结构上不可交付。修复：`ConstraintChecker` 新增 `collectConstraints`（与 `checkConstraints` 共享私有检查体 `runAllConstraints`，唯一差别是不 throw：全量收集、guidelines 照常、trace 逐条照记），report 改直调；`checkConstraints` throw 契约逐字不动。**breaking**：包根删除六个公共导出符号——`ConstraintViolationHandler` / `executeWithBlock` / `executeWithCollect` / `executeWithSafeBoolean` / `ViolationStrategy` / `ViolationHandlingResult`（studio 零引用，迁移路径 = 删引用，收集语义改调 `collectConstraints`），按 1.6.0 发布（breaking 级别裁决见本节首）。顺手裁掉 report 的 html 格式（零测试的内嵌模板，json/markdown 保留）。测试：假绿回归用例先红后绿（真 fixture 不 mock）、collect 五枚用例

## [1.5.0] - 2026-09-08

### Changes
- ci(governance): CAPABILITIES.md 漏登 diff 门——sync-docs 写入后非空 diff 即失败，摘掉 --check 的 continue-on-error 空转 (#120)
- fix(constraints): code-review 修正——执法声明失实、门不限宽、gate 回归补测 (#119)
- test(cli): projectPath 约定闸收紧——闸2 从文件键集收紧为逐行冻结（豁免文件内新增 cwd 站点/行变形不再静默通过），闸3 补参数默认值形/模板字面量/双引号形匹配且扫描域从 core+gates 扩至整个下游层（src 减 cli）（harness#98）
- feat(constraints): 判定自带证据，capability_sync 按因果归因 (#119)
- test(cli): bin smoke 在 CI 缺 dist 时显式失败而非静默 skip；coverage-gate 补 build 先于 test（harness#99）
- test(core,cli): review 修正——passes-gate 覆盖率用例临时根改走 createProjectFixture 正本（tmpdir，mkdtemp 劫持统一回收，不再建仓内 temp-test-no-coverage-field 留未跟踪目录）；check.test 凭证字面量拆串补 WHY 注释（harness#97）
- refactor(cli): knowledge upsert/sync-status 迁出至 studio CLI (#110)
- refactor(update-user-model): 路径常量集中为 resolveUserModelPaths + env 覆盖（HARNESS_UUM_STATE_FILE/HARNESS_UUM_PROFILE_FILE），默认值不变 (#116)

## [1.4.0] - 2026-09-08

### Changes
- fix(core,gates)!: 两个测试门禁判「过没过」的依据统一为**退出码为主 + 文本交叉否决**（ADR-0014，harness#93）——判定收在 `core/validators/test-output.ts` 新增的 `judgeTestRun({exitCode, output, allowPartialPass})` 一处，两门禁的结论一律从它取：passes-gate 成功分支不再硬编码 `passed = true`（exit 0 而输出含 `✕` 用例 / `FAIL <path>` 套件行 / `N failed` 汇总行 → 判负），acceptance 弃用裸 `includes('PASS') && !includes('FAIL')` 兜底（通过的用例名里带大写 `FAIL`、路径含 `FAIL/` 目录名不再反转结论；jest 零失败汇总行无 "passed" 字样也不再误伤），文本再也救不回非零退出。`allowPartialPass`（CLI `--allow-partial`）的落点从「赦免非零退出」移到「关闭文本否决」这一维。exit 0 的空输出/零测试不再判负（零测试识别另票）。按 minor 发布：`PassesGate.check()` 的 `allowed` 得出条件属行为变更，studio 消费的 `{allowed, violations}` 形状不变
- refactor(core)!: **harness 核心判定不取数、不执法覆盖率**（裁决 B 删薄，ADR-0015，harness#94）——删 `core/validators/test-output.ts` 的 `extractCoverage`（stdout 文本正则路：jest `All files |`、istanbul `Statements :`、pytest-cov `TOTAL`）与公开类型 `TaskTestResult.coverage`（含 `types/session.ts` 模块内镜像类型的同名字段）：该正则的唯一用途是填这个全仓零读取的展示字段，`PassesGate.check()` 只读 `passed`/`evidence`。保留并逐字不变的两处真执法：CLI `harness passes-gate --coverage`（`coverageCheck`，读 json-summary、阈值默认 80、未达标不改退出码）与 `performance` 门禁的 `collectCoverage`；`check()` 入参类型 `TestResult.coverage` 亦保留（调用方自备数据，只原样回显）。职责边界定名：要「覆盖率不达阈值就拦」用 performance 门禁或 CI，不用 passes-gate。按 minor 发布：`TaskTestResult` / `ExtensionTestResult` 是包根公开类型的字段收缩，唯一外部消费方 studio 对该字段零引用（ADR-0012 核实），不留兼容 shim
- fix(core,gates)!: 两个门禁的 `-p/--project-path` 不再半失效（harness#95）——立约定「projectPath 只在 CLI 入口兜底一次，之后传到每个 IO/执行点」并据此修两处：`PassesGate.runTests()` 内部的 `const workDir = process.cwd()` 改为**必传形参** `runTests(workDir)`（此前 `-p` 只喂命令探测，执行与证据落盘仍在 cwd → 拿 A 工程的命令、在 B 目录跑、证据写进 B），`SpecAcceptanceGate` 删掉构造器默认值 `tasksPath: './tasks.yml'`、check() 取径统一 `path.resolve(context.projectPath, …)`（相对值不再按调用方 cwd 解析；acceptance 的「无 tasks.yml 即跳过」本身是 passed:true，读错位置即假绿）。约定正本 `src/cli/commands/CONTEXT.md`；机器可检两道闸：`src/cli/commands/__tests__/project-path-convention.test.ts`（CLI 层 cwd 只能是兜底形状 + 下游 cwd 站点与 `xxxPath: 相对值` 默认值冻结豁免表，逐条带理由、站点消失不删条目也失败）与 `project-path-anchoring.test.ts`（前提统一 cwd ≠ projectPath、不 mock 任何 IO 的行为回归）。同型扫荡三处豁免留痕：`release` 的 pkgPath（定义表本无 `-p`，根已逐个传给每条 `run(cmd, pkgPath)`）、`constraints` 的版本读取（报 harness 自身包版本，主锚 `__dirname`、cwd 仅兜底）、`core/spec/validator.ts` 的 `schemaPath: './specs/schemas'`（**确是同型病灶**：找 spec 文件用 projectPath、找 schema 用 cwd；`validateFile`/`loadSchema` 签名无根，属 spec 域收口，另票）。按 minor 发布：`PassesGate.runTests()` 是包根公开类的方法签名变更（调用方必须传执行根），无 config 构造的 `SpecAcceptanceGate` 其 tasks.yml 落点从 `<cwd>/tasks.yml` 变为 `<projectPath>/tasks.yml`
- feat(monitoring,core,cli): 坏行计数从 module 层贯通到消费面——立契约「**凡以 `skip` 策略读 JSONL，坏行计数必须到达该消费面的用户可见输出，或在调用点显式记名豁免并写明理由**」（#82 范围外项，harness#100）——#82 只做到「不抛 + 返回部分结果」，同一份损坏在四条路里两条静默吞、一条把损坏算成正常、一条报错，studio 端点连原来的 `logger.error` 都没了。承载纯增量、不动任何既有签名：`TraceCollector.readReport(filter?)` 与 `TraceAnalyzer.analyzeRecentReport(hours)` 是新增报告入口（就地返回形状 `{traces|summaries, skippedLines}`，`JsonlReadResult`/`JsonlBadLinePolicy` 不进包根，ADR-0003 类型面零扩张），`read()/readRecent()/readByConstraint()/getStats()/analyzeRecent()/analyzeConstraint()` 退化为丢掉计数的薄包装（#82 裁决 4 的兼容约束继续成立，`skipped-lines-report.test.ts` 用类型断言 + `@ts-expect-error` 在编译期钉住），计数是**文件级口径**（坏行没有 timestamp/constraintId 可归窗，故消费方无法用「原始行数 − 统计条数」反推——这条写死，挡实现捷径）。四处消费点逐一收口：`constraints report` 的坏行数挂 `ConstraintsUsageReport.traceFileExists` 同一降级维度（新增 `readProjectTracesReport()`，文本降级行 / `--json` 字段 / `--export` 摘要行三处呈现，只报条数不报路径与坏行内容）、`harness status` 的 `记录数` 保持原始行数口径**逐字节不变**（坏行另起一行 stderr，改口径属行为变更本票不做）、`constraints retire` 两条路径（交互与 `--yes` 直达）落盘前告知、`failure list` 的 #96 定稿文案与退出码逐字未动。其余 skip 读点逐个记名豁免（transcript / session-manager×2 / context-builder×2 / context-tracker / reference-tracker / recorder），豁免注释如实写明影响方向与不透传的代价；机器可检面新增 `src/utils/__tests__/jsonl-skip-disposition.test.ts` 三道闸（每个 `readJsonl` 调用点必须判得出策略、skip 读点集合冻结 12 处、每个读点上方 6 行内声明 `计数去向：` 且邻居声明不顶替）。studio 半边（端点响应体加 `skippedLines`）在 **dommaker/studio#451**，前置是本票随 `harness-ship release` 发版

## [1.3.0] - 2026-09-01

### Changes
- docs(release): 覆盖口径显式化——深度内部文件不在清单是裁决非遗漏（harness#77）
- feat(release): 发布物完整性自检能力公开导出（harness#77）
- refactor(boundary): 边界净化——词表泛化 + knowledge 缺省数据根 + failures.log 口径（harness#76）

## [1.2.3] - 2026-08-28

### Changes
- fix(test): mkdtemp 泄漏防护——setupFilesAfterEnv 劫持 mkdtempSync 统一清理

## [1.2.2] - 2026-08-26

### Changes
- fix: init 判重升级为能力检测，已有 workflow 覆盖治理命令时跳过创建 harness-governance.yml

## [1.2.1] - 2026-08-24

### Changes
- fix: init 更新 PRESERVE:governance 段只换 HARNESS 标记区间，不再清空段内手写内容
- feat: 注入链读取侧适配 AGENTS.md 落点（studio#307）
- feat: 适配 AGENTS.md 正本文档模型（studio#302）

## [1.2.0] - 2026-08-19

### Changes
- refactor(core): capabilities 统计规则收敛单份定义（ADR-0008，架构评审候选9）——4 项能力清单统计（CLI Commands / Quality Gates / Iron Laws / Guidelines）的 label+pattern+actual 抽为 `CAPABILITY_COUNT_RULES` 单例，check（buildCapabilityChecks）与 write（updateCapabilityCounts）两方向各自投影生成，对外签名与 CAPABILITIES.md 写回结果逐字不变
- refactor(cli,gates)!: 门禁命令定义形状对齐 CommandDefinition，bin/harness.js 单引擎单循环（ADR-0007，架构评审候选8）——删除 `GateCliDefinition`/`GateCliOption` 公开类型，`GateDefinition.cli` 直接为 `CommandDefinition`；`CommandDefinition` 新增 `bareRunsAction` 字段表达门禁裸跑语义。CLI 行为（命令名/别名/选项/子命令/help 输出）逐字不变
- refactor(core)!: 删除 checkConstraintsSafe + getConstraints() 的 .check 装配副作用（ADR-0006，架构评审候选6）——Safe 与 checkConstraints 逐行重复且生产零调用方；getConstraints 变为纯查询，返回类型收窄为 Constraint。`checkConstraints(ctx)` 签名与返回结构（P0 契约）不动
- refactor(core,types,monitoring,cli)!: 删除 guideline 例外机制（ADR-0005，架构评审确认）——`Constraint.exceptions`、config `exceptions`/`extend_exceptions` 键、`ConstraintContext` 24 个例外证据字段 + `exceptionReason`、checker 例外分支、trace `exceptionApplied`/`exceptionCount`/`mostCommonException`/`exception_overuse`/`add_exception` 滥用检测链全链路移除。生产行为无变化（机制从未触发，`checkException` 恒 false）；存量配置中的这两个键静默忽略，不报错不警告
- refactor(core)!: 删除 ConstraintInterceptor 第二执行引擎及 enforcement 类型——生产零调用方，拦截统一由 checkBeforeExecution 承担（ADR-0004，架构评审候选2）
- refactor(core): 生效集筛选逻辑收口一处（架构评审候选3，ADR-0001 闭环）

## [1.1.1] - 2026-08-17

### Changes
- docs: 评审收尾——ADR-0002 版本线 1.0.0 + 文档漂移对齐
- fix(core,cli,monitoring,types): D5/D8 收尾——tip 层级整链摘除 + constraint-doctor 死配置清理
- fix(core): O4 收尾——便捷 API 补 per-request customConfig（checkConstraint/checkBeforeExecution/checkConstraints/interceptOperation）

## [1.1.0] - 2026-08-16

### Changes
- docs(changelog): 清空 [Unreleased] 条目段，待 release 脚本生成 [1.1.0]（避免自动生成后残留重复条目）
- feat(sync-docs): AGENTS.md 知识入口行识别 .studio/CONTEXT.md 正本模型 (studio #188)
- docs(research): 恢复 wayfinder #27/#28 研究正本——harness 现状盘点 + studio→harness 边界盘点（原仅存于游离提交 e3ab6ac/d2874fc，未随 O11 纳入版本控制）
- feat(gates): command-gate PreToolUse hook 固化进包（studio #153）
- feat(completion-checkers): T7-E1 三纯判定函数 tdd-chain/phase-format/contract-presence + CompletionCheckersConfig（#160）
- docs: CLAUDE.md Key Subsystems 清除已删子系统行 + 修正 context/tools 描述（#40 收尾）

## [1.0.0] - 2026-08-16

### Changes
- feat(pkg): H3 exports 治理——./gates 子路径公开 CommandGate（#42）
- feat(core,cli,knowledge): H2 命名与收敛——setCustomConfig 迁移 per-request + KnowledgeType→KnowledgeSubsystem + capabilities 双轨收敛（O4/O5/O10-R3，#41）
- feat!(cleanup): 删除孤儿子系统并收窄 API 面（1.0.0，#40）
- docs(adr,context): ADR-0002 注册型能力「定义即注册+构建期闭环」+ CONTEXT.md 术语落地（#46）
- feat(hooks,cli): H5 hook/命令注册表闭环 + per-command 懒加载（G2/G7/O2/R6，#44）
- feat(gates): H4 门禁统一——Gate 三态 + gateRegistry 构建期闭环 + 声明式 order/enabled + runGates 单调语义 + bin 注册表驱动生成（#43）

## [0.19.0] - 2026-08-15

### Changes
- feat: H6 后半——CheckCache 计数采样 + trigger 参数化分组渲染 API（G5/G6，#45）
- test: 补 analyze-sessions / release 命令测试（O6）
- feat: update-user-model 增加 --days flag（O1）
- chore: package.json 元数据 kww→dommaker（O7）
- docs: 纳入 docs/ 与 AGENTS.md 版本控制（O11）

## [0.18.0] - 2026-08-15

### Changes
- test: init 片段/落盘钩子 plan 匹配模式一致性断言，防模板字面量转义 drift（#35）
- fix: npm run lint 恒失败——补 ESLint flat config 并清零存量违规，CI 接 lint 防再退化（#35）
- fix: 模板/提示裸名 npx harness 全改 scoped @dommaker/harness，自身钩子/CI 改 dogfood node bin/harness.js（#36）
- fix: sync-docs 不再误删 CAPABILITIES.md 中真实存在的 .tsx 模块行（#33）
- feat: SourceRef 增加 entryId 条目级回指字段（#23）
- fix: 内置 no_completion_without_verification 验证命令口径弱化（#25）
- fix: constraints retire 直达路径补 --yes 人确认闸门（#24）
- feat: custom 约束退役落点迁至 custom-constraints.yml（#82 D6 一处真相）
- fix: mergeConstraints 生效 config.yml 对 custom 约束的禁用

## [0.17.1] - 2026-08-09

### Changes
- fix(constraints): 自定义约束 promptInjection 未透传，收编约束进不了注入段

## [0.17.0] - 2026-08-08

约束体系重构（ADR-0001）：删除自动进化子系统，确立 check/prompt 二元模型。决策依据见 `docs/adr/0001-constraint-system-rearchitecture.md`。

### BREAKING
- **删除进化子系统**：`src/evolution/`（`autoEvolve`）、`src/constraints/`（`ConstraintRegistry` + `ConstraintLifecycleRunner`）、`src/monitoring/constraint-evolver.ts`（`ConstraintEvolver`）、diagnosis-rules 降级规则全部移除
- **删除 `flow` 命令**及 `--auto-apply`；trace 统计展示并入 `harness constraints report`
- **约束清单 42 → 25**（9 check + 16 prompt），定义文件改为 `definitions/{iron-laws,guidelines,prompts}.ts`；`tips.ts` 删除
- **`TIPS` 导出变化**：恒为空表并标记 `@deprecated`（仅为在途消费者编译兼容保留，后续删除）
- 退役 5 条（工具链已覆盖）：`no_any_type`、`test_coverage_required`、`no_coverage_decrease`、`readme_required`、`doc_required_for_public_api`
- 移出内置 2 条（studio 流水线专属，归 studio 自定义约束）：`two_stage_review_required`、`prefer_worktree`
- 工具淘汰 1 条：`read_before_write`（Edit 类工具已机械强制先读后写）
- 其余合并：`no_implementation_without_requirement`（吸收 review 变体）、`no_fuzzy_completion_claim`（吸收 no_self_approval/no_claim_without_evidence/no_excuse_patterns）、`no_fix_without_root_cause`（吸收 no_fallback_without_root_cause/analysis_verification_gate/diagnosis_to_fix_gate）、`simplest_solution_first`（吸收 no_creation_without_reuse_check/yagni_check）
- 使用方 config.yml 中被移除条目的 `enabled: false` 残留无害（生效集计算忽略未知 id，`constraints report` 会提示）

### Added
- **`harness constraints report`**：check 层使用统计（total/pass/fail/skip、fail 率、首末触发）+ 四类退役候选诊断（零触发/零拦截/不可评估/高噪）+ 配置健康（unknownIds 残留）+ 注入漂移小节；`--export [file]` 输出脱敏 markdown 摘要供回传维护者
- **`harness constraints retire [id] [--reason]`**：交互选择器 + 一次人确认；落盘 config.yml `enabled: false` + `retired` 元数据（at/reason/stats）；KnowledgeStore 写决策记录（规则原文+原因+历史统计）；自动同步 CLAUDE.md 注入段；删除 config.yml 对应段即可回滚
- **`getEffectiveConstraints(projectRoot)` 公共 API**：全仓唯一生效集来源——内置 → preset 裁剪 → config.yml 禁用 → custom 追加 → scenes 过滤；init 注入/check/消费方全部走它（`src/core/effective-constraints.ts`，附 `lintEffectiveConfig` 诊断）
- **skip 语义**：约定未采用（`capability_sync`/`docs_freshness`/`context_doc_sync` 存在性探测）或 flag 未接线 → skipped（satisfied=true，不阻断、不计入通率），trace 记 `result:'skip'`；`detectTrigger` 补 `code_implementation` 推断（代码文件变更），新增 `extraTriggers`
- **注入漂移校验**：`check` 警告不阻断（版本漂移 ⚠️ 单独显眼提示），`report` 给条目级 diff（`injection-drift.ts`）
- **config.yml 新增 `scenes: string[]`**：场景专属 prompt（`no_skill_without_test`、`no_model_for_deterministic`）仅在 scenes 命中时进入生效集
- **`no_hardcoded_credentials` 真 checker**：凭证模式扫描 staged diff（接入 sensitive-check）
- init：注入段只渲染生效集；Output Style 段标记化（HARNESS_OUTPUT_STYLE_START/END）；幂等修复

### Changed（行为变化，发版须知）
- config.yml 的 `preset` 字段现在**真正影响运行时检查**；`relaxed` = 仅 5 条 check（3 iron + 2 guideline），prompt 全禁用
- init 注入尊重配置：禁用/裁剪后的约束不再出现在 CLAUDE.md 注入段（注入条目 ~38 → ~21）
- trace 读写路径统一为 `.harness/logs/traces.log`（`DEFAULT_TRACE_FILE`，`src/types/trace.ts`）
- `harness check` 输出可能新增注入漂移警告（不阻断）

### Fixed
- `capability_sync` checker 三处校验缺陷：step1 改为要求每个变更文件都被覆盖（every 而非 some，杜绝漏网）；修复 endsWith 后缀碰撞（xfoo.ts 误被 foo.ts 覆盖）与 includes 子串误配（docs/src/foo.tsx 误被 src/foo.ts 覆盖）（含回归测试）

## [0.16.9] - 2026-08-08

### Changes
- feat(capabilities): CAPABILITIES.md 支持策划制模块级清单——新增 `governance.capabilities.mode`（file/module/listing，缺省 file 行为不变）；module 模式下 capability_sync 第二步改为「文件条目精确匹配 OR 目录条目前缀」覆盖判定、sync-docs 不再自动加文件行（幽灵剔除保留）、--check 按目录聚合报告未登记模块
- feat(sync-docs): 新增 `--compact` 迁移命令，同目录 ≥2 个文件行折叠为一行目录条目（幂等、PRESERVE 块保留）
- test(checker): 补 capability_sync 第二步全量扫描专项用例（T-058 核心逻辑此前无测试覆盖）

## [0.16.8] - 2026-08-08

### Changes
- fix(sync-docs): CAPABILITIES 幽灵条目全路径清扫 + docs_freshness 报出缺失文件名
- docs(readme): 深度重构后 README 刷新 (#16)
- docs(changelog): 补 0.16.7 条目——修复 changelog_version 版本漂移门控

## [0.16.7] - 2026-08-07

### Changes
- **深度重构**：constraints definitions 拆分为 iron-laws/guidelines/tips 三层；checker 规则拆至 checkers/ 目录；checkpoint 校验拆至 validators/check-handlers/；sync-docs 拆为 sync-docs/ 模块族；会话挖掘收拢至 cli/session-mining/
- **死代码清理**：删除 governance executor、prompt-injection 别名、knowledge 孤儿脚本等（-12000+ 行）
- fix(checkpoint): output_* 检查行为修复；validate 门控失败时返回退出码 1
- refactor(monitoring): constraint-doctor 诊断规则数据化（diagnosis-rules）

## [0.16.6] - 2026-07-29

### Changes
- fix(sync-docs): AGENTS.md 知识入口不再写入易变的条目数

## [0.16.5] - 2026-07-27

### Fixed
- **init 不再覆盖已有运行时配置**：重跑 `harness init` 时，`.harness/checkpoints.yml` 与 `.harness/resolutions.json` 已存在则跳过（打印灰色提示），不再被静默重置为内置默认——与 custom-constraints.yml 的既有存在检查行为对齐。两个文件均不入 git，此前被覆盖无版本兜底

## [0.16.4] - 2026-07-24

### Added
- **sync-docs --agents PRESERVE 标记段**：AGENTS.md 中 `<!-- PRESERVE:名称 -->` 与 `<!-- /PRESERVE:名称 -->` 之间的内容由使用者保留——重新生成时原样穿过（附于生成内容之后，保持相对顺序），漂移比对基于"生成部分 + 保留块"的组合结果，块内手改不报漂移，`--check` 对组合文件可用。未闭合的标记块不予保留并告警。

## [0.16.3] - 2026-07-22

### Changes
- fix(sync-docs): 删除 stale 条目正则修复 — basename 匹配完整路径列
- test(sync-docs): 补 --agents 覆盖率低分分支（statements 78.9% → ≥79.5%）
- docs: CHANGELOG 补齐 0.16.1/0.16.2（修复 docs_freshness 铁律 changelog_version 检查）

## [0.16.2] - 2026-07-20

### Added
- **sync-docs --agents**: AGENTS.md 生成器——面向 agent 的仓库导读（结构/命令/约束/知识入口），挂在 `sync-docs` 命令下

### Fixed
- CLAUDE.md 分层计数修正（13/27 → 12/28）
- src/cli/commands/CONTEXT.md 命令计数修正（21 → 25，补 sdd/constraints/doc-freshness-check/spec-baseline-check）
- CHANGELOG 补齐 0.16.1/0.16.2（修复 docs_freshness 铁律 changelog_version 检查）

## [0.16.1] - 2026-07-17

### Added
- knowledge 模块导出纳入发布产物
- CAPABILITIES 增加 sdd CLI 命令

### Changed
- release 命令支持受保护 master 分支时改走 PR 流程

## [0.16.0] - 2026-06-10

### Changed
- **prefer_worktree demoted to guideline**: `prefer_worktree` moved from iron_law to guideline severity — worktree usage is now recommended, not enforced
- **KnowledgeStore interface extracted**: `FileKnowledgeStore` implements `KnowledgeStore` interface, enabling mock/testing and future alternative implementations

## [0.15.0] - 2026-06-07

### Changed
- Internal release (constraint tier adjustment prep)

## [0.14.0] - 2026-06-04

### Added
- **ConsumptionMode + KnowledgeOrigin types** (AS-021 P1): `rule | context | signal | reference` 消费模式，`system | agent | human | external` 知识来源
- **Per-mode lifecycle** (AS-021 P2): rule/context/signal 三条独立生命周期路径
- **queryByMode + consume()** (AS-021 P3): 按 consumptionMode 查询 + 消费时 recordReference
- **External content sanitization** (AS-021 P4): `ingestExternal()` 剥离 prompt injection 模式 + 长度限制
- **Migration script + CLI** (AS-021 P5): `harness knowledge migrate` 旧条目自动标记 consumptionMode
- **6-dimension quality audit engine**: `harness knowledge audit [--fix] [--dry-run]`，健康分 + 自动修复
- **KR4 snapshot mechanism**: 每日 index.json 快照 + 30 天存活率统计
- **GAP-11 promotion content quality gate**: draft→verified 要求 content ≥ 50 字符
- **Semantic dedup + test ID interception**: KnowledgeIngest 去重增强
- **Execution success rate tracking**: Path C 自动晋升依据
- **Human/auto contributor classification**: 晋升来源区分
- **D6 flywheel stats**: `harness knowledge stats` 展示飞轮指标
- **hooks → Agent Event Protocol API** (B9-016): 通用 hook 管线暴露为 API

### Fixed
- **飞轮质量审计 5 项根因修复**: 噪音治理 + 资源优化
- **B12 噪音治理**: 低质量条目过滤 + 资源优化
- **E3 findFile 碰撞修复**: 文件查找哈希碰撞
- **`no_delete_without_context` 增强**: 零引用 ≠ 无价值
- **undefined tags/applicablePhases guard**: matchesFilter 空值保护

## [0.13.0] - 2026-05-26

### Breaking
- **prompt-injection 迁移**: `formatConstraintsForPrompt()` + `AgentRole` + `ROLE_TRIGGERS` 迁至 `@dommaker/studio-shared`。harness 保留 deprecated re-export。
- **`buildConstraintPrompt()` 移除**: 孤儿函数从未消费，且截断 80 字符。已删除。
- **死亡代码清理**: `changelog_freshness` 孤儿约束、`changelog_missing` DiffType、`sync-docs --changelog`、`auto_append` config。

### Added
- **`detectSourceRoots()`**: 统一源码目录发现。支持 monorepo (packages/*, apps/*) 和单 repo (src/, lib/)。替代 5 种分散硬编码。
- **`harness constraints --json`**: 约束元数据导出（version, hash, counts, textSize）。
- **`harness init` → CLAUDE.md**: 写入标记段（HARNESS_CONSTRAINTS），含约束列表和版本号。
- **`module_creation` 触发**: `detectTrigger()` 识别新目录文件变更。
- **11 条约束补 `promptInjection`**: `no_code_without_test` 等从不可见变为 CLAUDE.md + Agent prompt 可见。

### Changed
- **内置 Freshness 泛化**: 10 项 harness 特化 → 2 项通用（CONTEXT.md + CHANGELOG 版本）。
- **`findSourceFiles` 跳过 `index.ts`**: 与 `scanSourceModules` 一致。
- **管线运行时去重**: CLAUDE.md 已有约束段时注入引用而非全量文本。
- **预设 `required_dirs` 自动发现**: 不硬编码 `['src']`。

### Fixed
- `@jest/globals` 缺失 → 安装后 119/119 测试通过。
- monorepo 工程 `harness init` 后全部检测盲过。
- `index.ts` 导致 `docs_freshness` 误报。

## [0.12.2] - 2026-05-19

### Added
- **fix_the_problem_not_the_gate guideline**: 质量门阻断时修复代码，不修复门禁

## [0.12.1] - 2026-05-19

### Added
- **first_principles_first guideline**：第一性优先分析方法论。injectPrompt=true。
- **5 behavioral guidelines**：surgical_changes_only / no_model_for_deterministic / no_conflict_blending / read_before_write / follow_conventions。全部 injectPrompt=true。
- **2 增强 promptInjection**：no_performative_agreement / simplest_solution_first 补充 prompt 注入文本。
- **interceptor 收敛**：无 executor 时 fallback 到 constraint.check(ctx)。

### Changed
- **docs_freshness 升级为 iron_law**：guideline → iron_law (blocking)。
- **CONTEXT.md 删除**：17 个文件。目录描述集中在 CLAUDE.md Key Subsystems 表。
- 约束总数：13 Iron Laws + 13 Guidelines + 2 Tips = 28 条。
- promptInjection 优化：357→80 tokens (75% 缩减)。
- **约束生命周期修正**：退化基于拦截率（≥10 次检查 + 拦截率 < 30%），不基于日历时间。

## [0.11.0] - 2026-05-03

### Added
- **6 条新约束**：must_use_worktree / no_fuzzy_completion_claim / no_performative_agreement / two_stage_review_required（Iron Law）+ no_excuse_patterns / yagni_check（Guideline）
- **meeting_decision_check trigger**：会议决策质量检查
- **buildConstraintPrompt()**：收集约束 promptInjection 格式化为 Agent system prompt 片段
- **knowledge/failure CLI**：harness knowledge / harness failure 命令
- **sync-docs 命令**：文档新鲜度检查 + JSON 输出

### Changed
- 约束总数：8 Iron Laws → 12，13 Guidelines → 15，共 29 条
- AI 治理简化：移除冗余 hook/apply，harness 只检测不修复
- interceptor 修复 + 覆盖率 85.4% + JSDoc
- `autoEvolve()` 纯计算 API + `evolution/auto-evolve.ts` 新模块
- `checkConstraints()` 新增 `onTrace` 回调参数

## [0.9.0] - 2026-05-01

### Added

#### Phase 1: 知识引擎核心
- KnowledgeStore: 知识条目 CRUD + 结构化存储
- KnowledgeQuery: 语义搜索 + 类型/标签过滤
- ReferenceTracker: 知识引用关系图谱
- KnowledgeLinter: 知识质量检查 (完整性/一致性/时效性)

#### Phase 2: 上下文管理
- TokenBudget: 多级 token 预算分配 (system/user/tool/reserve)
- SessionCompaction: 会话压缩策略 (摘要/截断/滑动窗口)
- AgentLifecycle: Agent 状态机 (init→running→paused→completed→failed)

#### Phase 3: 安全护栏
- InputGuardrail: 输入内容安全检查 (注入检测/敏感信息/格式校验)
- OutputGuardrail: 输出内容安全检查 (泄露检测/有害内容/格式合规)
- ToolGuardrail: 工具调用安全检查 (权限验证/参数校验/速率限制)
- Sandbox: 沙箱执行环境管理 (级别 L1-L4/资源限制/隔离策略)

#### Phase 4: 知识引擎集成
- KnowledgeService: 统一入口 (Store + Query + Tracker + Linter)
- 知识生命周期: draft → candidate → validated → canonical → archived
- 跨项目知识迁移: 模式识别 + 最佳实践提炼

#### Phase 5: 约束重构
- ConstraintContext 扩展: 新增 isExternalDependency/isExplicitInstruction/isEmergencyFix/isExistingDesign
- 自定义约束配置: .harness/config.yml 支持 extend_exceptions
- 约束进化提案: 基于 trace 分析自动生成优化建议

#### Phase 6: 冷启动
- progressive-loader.ts: 渐进式加载 + worker pool 并发
- cross-project-checker.ts: 跨项目依赖检查 (异步化)
- project-config-loader.ts: 项目配置加载 + 约束合并

### Changed
- SafetyService/ContextService/AgentService 单例导出
- KnowledgeService 单例导出
- CLI 新增 harness flow --auto-apply 自动应用低风险提案

## [0.8.4] - 2026-05-01

### Changed

#### 重复代码消除
- 统一 `execAsync` 到 `utils/exec`：15 个文件的重复定义合并为单一来源
- 新增 `normalizeTriggers()` 泛型工具函数，消除 10+ 处 `Array.isArray` 重复模式
- 新增 `delay()` 公共函数，替换 3 处私有 `sleep/delay` 方法

#### 逻辑简化
- `checker.ts`：60 行 `switch` 例外匹配 → `EXCEPTION_FIELD_MAP` 映射表 + `some()` 一行
- `checker.ts`：3 个近似循环 → 提取 `matchesTrigger()` + `recordTrace()` 公共方法
- `interceptor.ts`：触发器规范化 → 复用 `normalizeTriggers`
- `trace-analyzer.ts` / `performance-analyzer.ts`：5 次/3 次遍历统计 → 单次遍历
- `failure/recorder.ts`：`getByType`/`getByLevel` 重复过滤 → 提取 `getFiltered()`

#### 健壮性修复
- 修复 `checker.ts` 中 Guidelines 循环直接引用 `GUIDELINES` 常量的 bug（未使用自定义约束配置）
- 修复 `project-config-loader.ts` 中 `mergeConstraints()` 的 for 循环缩进错误（方法体脱离类作用域）
- 修复 `progressive-loader.ts` 中 `delay` 参数名与导入函数冲突
- 补充 `ConstraintContext` 缺失字段：`isExternalDependency`、`isExplicitInstruction`、`isEmergencyFix`、`isExistingDesign`

#### 性能优化
- `cross-project-checker.ts`：`execSync`（阻塞式）→ 异步 `runCommand`
- `progressive-loader.ts` `processBatch`：并发结果顺序不保证 → worker pool 模式保证输入顺序

#### 代码规范
- `cli/commands/status.ts`：`any` 类型 → `TraceSummary` / `TraceAnomaly`
- `cross-project-checker.test.ts`：更新 mock 从 `child_process` → `utils/exec`
- 合并 10+ 处分散的 `import { exec } + promisify(exec)` 为统一导入

> 净减少约 157 行代码，零编译错误，零测试回归

---

## Recent Commits

- feat: add command CLI for blacklist checking (2026-04-29 23:24:07 +0800)
- feat: add CommandGate for command blacklist (SEC-006) (2026-04-29 23:09:44 +0800)
- fix: remove deprecated command tests (propose, diagnose, traces) (2026-04-29 01:10:46 +0800)
- chore: release v0.8.0 (2026-04-28 23:41:32 +0800)
- docs: decouple Trace section from business logic (2026-04-28 23:39:12 +0800)
- chore: remove docs and specs directories (moved to .gitignore) (2026-04-28 23:37:35 +0800)
- chore: ignore docs directory (2026-04-28 23:36:39 +0800)
- docs: remove deprecated note from README (2026-04-28 23:34:30 +0800)
- refactor(cli): remove deprecated commands (traces, diagnose, propose) (2026-04-28 23:32:26 +0800)
- docs: sync CLI commands to README (2026-04-28 23:23:47 +0800)
- feat(cli): add 5 gate commands - acceptance, performance, security, contract, review (2026-04-28 23:04:33 +0800)
- chore: ignore specs directory in gitignore (2026-04-28 22:56:59 +0800)
- chore: ignore specs/templates 目录 (2026-04-28 22:52:51 +0800)
- feat: 新增覆盖率约束机制 (2026-04-28 22:50:15 +0800)
- test: 覆盖率达标 85.43%！ (2026-04-28 22:39:48 +0800)
- test: 覆盖率提升至 84.8% (2026-04-28 22:34:31 +0800)
- test: 覆盖率提升至 83.93% (2026-04-28 22:29:51 +0800)
- chore: 清理临时测试文件 (2026-04-28 22:21:01 +0800)
- test: 覆盖率提升至 84.17% (2026-04-28 22:20:54 +0800)
- init (2026-04-28 22:11:12 +0800)

---

> 自动生成于 2026-04-30
