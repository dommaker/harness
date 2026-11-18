# knowledge/

## 职责
知识引擎：知识存储(CRUD)、语义查询、质量审计(Audit，健康面唯一正本)、生命周期管理、冷启动导入、摄入前校验(validateEntry)、外部内容摄入。

## 三维分类体系 (AS-021)
知识由三个正交维度定义：
- **Topic** — 开放集，用 `tags: string[]` 描述
- **ConsumptionMode** — 闭集 (rule/reference/context/signal)，驱动注入策略和生命周期
- **Origin** — 闭集 (human/agent/external/system)，影响信任度和 maturity 起点

## 生命周期按模式分化
- `rule`: draft → active → deprecated (1 次成功激活, 失败率>=50% 降级)
- `reference`: draft → verified → proven → archived (现有逻辑)
- `context`: draft → active → archived (1 次引用激活, 3 个月未引用归档)
- `signal`: active → archived (消费饱和: ref>=3 + 有更新同标签条目)
- 所有模式支持 `decayAt` 硬过期

## 核心导出
- `KnowledgeStore`（类型面）/ `FileKnowledgeStore`（`store.ts`，barrel 与包根交出的**值**符号——store 的文件系统实现，构造收 `{ baseDir }`；仓内构造点一处：`cli/commands/knowledge/store-access.ts` 的 `openKnowledgeStore()`（knowledge 各子命令的统一取数口；退役沉淀与 ADR-0032 复活写口也经同一解析点注入，不另起构造，harness#177）
<!-- sync-docs:construction-sites FileKnowledgeStore = 1 -->）— 知识条目 CRUD + 结构化存储；`saveAll()` 全量批量写入（循环内只更新内存索引、结束一次 writeIndex，harness#107）、`applyAll()` 按 id 部分更新的批量出口（`update(id, partial)` 的批量形，语义含未知 id 逐条跳过与空批零读写，harness#134；D7 起可选第二参 `bases` 预载基线 `ReadonlyMap<id, entry>`——缺省/缺项回退 `get(id)`，一参实现的外部自定义 store 编译运行兼容）、`getConsumptionStats()` 读 `.consumption-stats.json` 的当日消费计数（打分核心唯一的消费统计取数口，harness#134）。**写入闸（E1 复盘修正 M1）**：save/saveAll/applyAll 落盘前校验 maturity/layer 枚举（update 经 save 继承），未声明值拒写抛错不静默降级；值域正本 = `types.ts` 的 `MATURITY_LEVELS`/`STORAGE_LAYERS` 常量（不进 barrel）。批量路径先整批预校验再落盘（任一脏值全批拒写）；applyAll 批内同 id 多条按序累积合并语义不变。**路径构造收口（D6）**：条目文件路径唯一构造点 = 私有 `entryPath({id,type})`——index 驱动的 get/delete fast path 与 save/saveAll/applyAll/update 写入全经此一处，不各写拼接；id/type 先过路径分量闸（空串/`'.'`/`'..'`/路径分隔符含 Windows 反斜杠/NUL 一律 fail-fast 抛错，不做 basename 静默修正），非法值写不到 baseDir 外；`readIndex()` 对 index 在册条目的 id/type 过同闸校验，非法条目抛含条目序号/字段/值与「手工修正 index.json / harness knowledge index（rebuildIndex）」提示的错，校验通过才进缓存。**index 元数据收口（D7）**：QueryFilter 全字段过滤的唯一实现 = 包内导出的 `filterIndexEntries`（store.list 与 KnowledgeQuery.query 共用，不各写一套）；index 条目的正文 token 元数据 `tokenCount`（= `estimateTokens(content)+estimateTokens(title)` 两次 ceil 口径，运行时 index JSON 扩展字段，公共 `IndexEntry` 不变）由 `toIndexEntry` 在 save/saveAll/applyAll/rebuildIndex 全写路径落盘；`list()` 与可选能力 `materializeByIndex(indexEntries)` 共用同一「索引在册但文件缺失」漂移错误正本（query 截断后只物化最终返回子集，被过滤/截断排除的条目全文零读取）；缺 tokenCount 的旧格式 index 读取时经 console.error 打一行 rebuildIndex 提示（实例级一次），普通 query 回退 list+applyBudget 兼容路径（截断/tokensUsed 语义不变）
- `KnowledgeQuery` — 语义搜索 + 类型/标签过滤 + `queryByMode()` + `consume(taskContext)`；`query()` 是 budget 截断管线（仅用于 prompt 注入）：普通 query 先经 `readIndex()` + `filterIndexEntries` 按 index 元数据全字段过滤、maturity desc→lastReferenced desc 排序、maxEntries/maxTokens 截断（tokenCount 元数据，溢出候选全文零读取），只物化最终返回集（`store.materializeByIndex`，索引漂移错误单一正本）；store 未提供该可选能力或候选缺 tokenCount（旧索引）时回退 list+applyBudget 兼容路径，truncated 恒 = 返回数 < index 过滤候选数；`search()` 是全语料文本搜索（store.list 全量物化，先对 title/content/tags 匹配→排序→limit，交互搜索专用，勿用 query() 代替），无缓存、无引用副作用；`estimateTokens()` 委托 `token-estimate.ts` 正本（harness#197），方法名与语义不变
- `EXTERNAL_SOURCE_MARKER`（`query.ts`，barrel 与包根交出）— 外部来源条目的 prompt 标记标准唯一正本（harness#161 三层防御第二层）：`KnowledgeQuery.formatForPrompt()` 与下游编排消费方的注入格式化共用同一常量，仓内不允许第二份字面量
- `estimateTokens(text)`（`token-estimate.ts`，barrel 与包根交出）— 仓内**唯一** token 尺子正本：逐码点累加，CJK 三段（U+3400–4DBF / U+4E00–9FFF / U+F900–FAFF）2 token/字、其余 0.25 token/字、向上取整。提出为纯函数的理由：消费方要的是尺子，不该为了量一段文本先持有一个带 store 的 `KnowledgeQuery`（下游消费方 30 处静态调用即此形状）。`KnowledgeQuery.estimateTokens` 从这一份取数，**不再另写实现**（注入编排归下游编排消费方，ADR-0022）
- `KnowledgeLifecycle` — per-mode 生命周期管理；缺省阈值常量 `DEFAULT_DECAY_CONFIG`（`provenDecayMonths: 12` / `verifiedDecayMonths: 6` / `draftDecayMonths: 3`，正本 `types.ts`）经构造器 `{...DEFAULT_DECAY_CONFIG, ...config}` 合并，barrel 与包根一并交出；候选判定两族同位（tryPromote 升 proven 后自动触发）：`checkSkillCandidate`（AC-8a）与 `checkConstraintCandidate`（块 3 子项 6，ADR-0033——口径 = proven + 未打标 + referencedBy≥5 + contributors≥3 个不同来源会话，打 `constraintCandidate` 标 + `constraintCandidate:marked` 事件，与 skillCandidate 互不干扰可同挂）；`recordReferences()`——`recordReference` 的批量形，一次 query 的 N 条引用收集进一次 `store.applyAll()` 落盘（query 侧不逐条 recordReference→update→全量重写 index.json），逐项语义与逐条版一致（same-day refKey 去重且去重时 success 给定额补记 executionResults、referencedBy 20 条上限、contributors 去重、未知 id 跳过、批内同 id 只记一次；回调保持「不早于持久化成功」语义——批量落盘成功后逐条触发，去重/未知 id 不触发）；D7 引用复用：可选第五参 `preloaded`（id→完整条目，query 传入本次已物化条目）——条目查线不再 store.get、applyAll 以预载为合并基线（每条结果全文全程只读一次），缺省走原取盘路径、原四参公共调用兼容；preloaded 缺项的 id 回退 store.get 取盘，取不到才按未知 id 跳过；单事件调用方仍用 `recordReference()`（返回更新后条目 + 触发回调的契约不变），记账写计数闸见 `query.test.ts` 批量化块与 `lifecycle.test.ts` 的 `recordReferences` 块
- `KnowledgeIngest` — 知识摄取引擎（含 ingest gate）；`ingestEntry`/`ingestBatch`/`ingestExternal` 返回判别联合 `IngestResult`（`accepted` 已落盘 / `rejected` 拒收未落盘 + `reasons`）；`ingestExternal()` 外部内容摄入口（强制 `origin: 'external'`，内容先过 `sanitizeExternalContent()` 脱注入模式+限长——外部内容三层防御第一层，ADR-0041）；`validateEntry()` 摄入前单条校验（title/content/tags/type 四字段必查，maturity/layer 枚举字段缺省跳过以兼容 pre-ingest 调用方，返回 `IngestValidationIssue[]`，severity='high' 按阻断处理）。**ingestBatch 批量语义（D7）**：批首惰性各读一次 `readEntriesFromDisk`（共享去重视图基线）与 `readIndex`（虚拟序号/索引状态起点）；逐条 build→audit.validate→reject（不入视图）或 视图去重（磁盘基线+本批已接受终态的 overlay，批内重复语义与旧逐条路径一致）→merge（`computeMerge` 纯 helper 共用，merge 分支不做新条目 auto-fix）或 新建（auto-fix 折进终态；返回值仍是 pre-fix entry，store 中才是终态）；新建与 merge 的完整终态统一收入写计划，批尾一次 `saveAll`——全批只重写一次 index.json、整批预校验（任一脏枚举全批拒写、不制造已落盘假象）、批内同 id 按 saveAll 后写覆盖语义；自动 id 的虚拟序号以条目的 auto-fix 后 maturity 即时入列（archived/deprecated 不计序号，复刻旧逐条路径的批内碰撞口径）；空批零读写。`ingestEntry`/`ingestExternal` 单条公共契约与写时序不变（save + 逐 fix update）
- `KnowledgeAudit` — 7 维度质量审计**引擎**：构造收 `KnowledgeStore`（与 query / lifecycle / ingest 同形）+ 可选阈值形参（三个数值槽显式传 NaN/±Infinity/负数时构造期抛 `TypeError`（message 含槽名与实参），不放行到打分层静默关掉 short-content/stale-entry/promotion-blocked 三条判定；未传/显式 `undefined` 走缺省、显式 `0` 合法按 0 生效，harness#163）。职责只剩装配：取条目、经 store 取环境数据、把整批修复动作交 `store.applyAll()`。per-entry 规则记录带 `scope: 'active' | 'all'`（active = 不判定 archived 条目）；人口过滤由 `ruleDetail()` 统一执行，规则内禁止再写 `entry.maturity === 'archived'` 早返回。规则中文 label 正本在规则定义的 `label` 字段（harness#109，ADR-0002 定义即注册），`AUDIT_RULE_LABELS` 派生导出、与 `AuditRuleName` 编译期闭环，CLI 展示层直接消费、禁止另建 label 表
- `audit-rules` / `audit-scoring` / `audit-dimensions`（**值面**不进导出面；类型面是例外——`AuditRuleName`/`AuditAction`/`AuditIssue`/`AuditReport`/`AuditOptions` 经 `index.ts` 再导出并上包根，ADR-0003 显式清单）— D1–D7 打分**纯模块组**（harness#134）：`audit-rules.ts` 规则数据表（detect 谓词 + label + 规则常量 + `AUDIT_RULE_LABELS`）、`audit-scoring.ts` 评分（`resolveThresholds()` / `scanEntries()` / `summarizeIssues()` / `calculateHealthScore()` 与阈值缺省常量）、`audit-dimensions.ts` 维度计算（`computeDimensions()` / `computeIncremental()` + `AuditReport`/`DimensionMetrics`/`AuditEnv`），全部零 fs——环境数据（消费统计、快照存活）由调用方经 store 取好喂入。审计判定的唯一正本在此，可脱离合建目录测试
- `tree-walker`（包内，不进导出面）— 知识树排除口径单点（harness#134）：`isEntryFile()` / `isInfraDir()` / `INDEX_MD_FILE` / `SNAPSHOTS_DIR`，由 store 顶层扫描、index-generator 递归扫描两处共同消费
- `flywheel-metrics`（包内，不进导出面）— 知识飞轮指标唯一实现：`evaluateFlywheel(env)` 出 canonical 比例、`genuineRefs()` 出 synthetic 过滤口径，audit D6 / `knowledge stats` / `knowledge health` 三处共消费（ADR-0013）
- `ColdStartImporter` — 冷启动知识导入

## 依赖关系
- 知识类型正本在**本模块** `src/knowledge/types.ts`（`KnowledgeEntry`/`MaturityLevel`/`ConsumptionMode`/`KnowledgeOrigin`/`DecayConfig`…）；本目录对 `src/types/` **零 import**（逐条核对结论，harness#142）
- 依赖 `src/utils/frontmatter` — markdown frontmatter 解析/序列化的唯一正本（harness#89：store、index-generator、ingest 共用同一套语法判定，不再各写正则）
- 不依赖 `src/context/`（ADR-0022），也不依赖 monitoring——知识健康评分正本 = `audit-scoring.ts` 的 `calculateHealthScore`（`KnowledgeAudit.run()` 与 `knowledge health` CLI 共用）
- 被 `src/cli/commands/knowledge/` CLI 消费

## 约定
- 知识条目文件的 frontmatter 语法只由 `src/utils/frontmatter` 定义（harness#89）：缺头/空 meta = `absent`（合法输入，按非条目静默处理、不上报——harness#161 对齐 #89 裁决 2）；未闭合/YAML 非法 = `malformed`（必须显式上报后按消费方语义恢复——store 与 index-generator 打一行 stderr 后跳过或走 best-effort），禁止静默丢条目；canonical 字段序是 `store.toFrontmatter` 的私有策略，`join` 只管包裹格式
- **知识树的排除口径只有一个正本 `tree-walker`**（harness#134）：`_index.md`（索引生成物）、`.snapshots`、`.archive` / `archived`、`resolutions` 是树基建、不是条目人口。store 的顶层扫描、index-generator 的递归扫描两处都走它；新增 walker 禁止另立排除清单。统一的是**排除口径**不是遍历深度（store 顶层、index-generator 递归）。例外须原地记名理由：`cold-start.ts` 的 docs 扫描吃的是**项目文档树**，本口径在它那里没有对应物
- **循环内禁止逐条 `store.update()`**（harness#134）：`update()` 的形状是 get→save、`save()` 每次全量重写 index.json，N 条修复 = N 次全量重写。批量形是 `applyAll(id → partial)`；一次 `audit --fix`、一轮 `runDecayCycle()` 各只重写一次索引，计数闸见 `audit-write-count.test.ts` 与 `lifecycle.test.ts` 的 stringify 计数项
- **D7 批量读写与按需物化的 IO 契约**（行为闸，非性能数字）：普通 query 被过滤/截断排除的条目全文零读取、每条结果全程只读一次（物化一次；引用记账与 applyAll 经 preloaded 零重复 get——`query.test.ts` fs 包装计数）；ingestBatch 的 readEntriesFromDisk 每批一次、index.json 每批写一次、空批零读写（`ingest.test.ts` fs 包装计数）；`store.list()`/`search()`/`queryByMode()`/`consume()` 仍全量物化（全文语料语义需要），不经按需物化路径
- **写入闸不管读**（E1 复盘修正 M1）：枚举校验只在 save/saveAll/applyAll/update 落盘前执行，读取（parseFile）不校验——盘上脏条目可读可列，但任一写入路径触及即抛错（含「只改其他字段」的部分更新），先修脏值再写；绕过本 store 直写文件的外部写入方不受闸约束
- **条目文件路径只有一处构造**（D6）：私有 `store.entryPath({id,type})`，index 驱动读的 fast path 与全部写路径共用；id/type 路径分量闸（空串/`'.'`/`'..'`/分隔符含反斜杠/NUL fail-fast，不 basename 修正，合法字符如点号/空格不收紧）与 `readIndex()` 在册条目校验的契约钉在 `store.test.ts` 的「路径构造收口（D6）」块；rebuildIndex 是盘驱动枚举、不经 index 构造路径，盘上 frontmatter 脏 id 由下一次 readIndex 校验拦截（错误提示含 rebuild 指引）
- **审计判定脱离文件系统可测**（harness#134）：规则表与 D1–D7 打分住 `audit-rules.ts` / `audit-scoring.ts` / `audit-dimensions.ts` 三块的纯模块组，零 fs（源形状闸钉在 `audit-scoring.test.ts`，扫整组）；引擎 `audit.ts` 只做 store 装配，环境数据经 `store.getConsumptionStats()` / `getSurvivalRate()` 取好喂入
- 知识条目有明确的生命周期状态（按 consumptionMode 分化）
- **两个 index-generator 是刻意平行、不合并**（ADR-0040 裁决）：`knowledge/index-generator.ts` 只管知识库树（文件即条目、递归遍历、走 tree-walker 排除口径、type 推断 + 标题提取），`sdd/index-generator.ts` 只管 `docs/sdd/` 项目文档树（目录即条目、平铺不递归、字段固定、stale 跳过）。两者只是形状相似（扫树 → frontmatter → 竖线行 → `_index.md`）：frontmatter 解析已共用 `utils/frontmatter` 正本，剩余相似仅 sanitize 一行与竖线 join；抽共享框架要参数化的恰是两者全部差异（扫描策略/条目提取/排序/过滤/表头），共享核不足 20 行，属投机抽象。改任一侧时禁止以「统一」为名把另一侧的领域逻辑搬进来
- 约束退役（`harness constraints retire`，人确认）时写入 KnowledgeStore：规则原文 + 退役原因 + 历史统计
- Audit 7 维度评分：D1结构 D2内容 D3去重 D4成熟度 D5新鲜度 D6飞轮 D7增量存活
- Ingest gate: ingestEntry() 先经 audit.validate() 检查，reject 不入库——拒收经返回值判别联合 `IngestResult` 的 `rejected` 分支上抛（带 reasons），不在条目上偷挂私有字段
- 外部内容三层防御：ingest sanitization + retrieval marking + prompt constraint。第二层 marking（harness#161）：标记正本是 `knowledge/query.ts` 的 `EXTERNAL_SOURCE_MARKER` 常量（`[External Source — verify before acting]`，经包根公开导出），`KnowledgeQuery.formatForPrompt()` 使用同一常量——`origin === 'external'` 条目进 prompt 时带来源前缀；原注入路径已随 KnowledgeInjector 删除（ADR-0022），消费方格式化时经包根导出的同一常量对齐标记标准。第三层（prompt constraint）在本仓不可核（属下游 agent 侧提示词），未核不改
- 消费饱和度替代固定 TTL 用于 signal 过期判断
- **飞轮指标只有一个实现**（ADR-0013）：`refCoverage` / `avgRefs` / `consumptionHitRate` 一律出自 `flywheel-metrics.evaluateFlywheel()`，canonical 分子 = `genuineRefs()` 过滤后的真实消费引用（`search|test-agent|prompt-inject|monitor|analyst|...:<date>` 自动化按天记账键不算消费，`unknown:` 注入键算消费）。audit D6 / `knowledge stats` / `knowledge health` 只在展示层做单位与字段名映射（百分比取整、一位小数、`avgRefs`→`avgRefCount`），人口筛选留在各调用方。新增消费方禁止自行数 `referencedBy.length`。

## 注意事项
- `extractCodeStructure` 已删除（ADR-0038，连同 `primitives/` 整目录与 `CodeStructure`/`DeclarationInfo`/`ImportInfo` 三类型）
- 约束"退役不删除"——retire 落盘 config.yml `enabled: false` + retired 元数据，保留规则原文 + 退役原因 + 历史统计（可回滚）
- `MaturityLevel` / `StorageLayer` 的值域不抄清单——运行时正本是 `types.ts` 的 `MATURITY_LEVELS` / `STORAGE_LAYERS` 常量（写入闸与摄入校验共用）
- `excludeArchived` 同时排除 archived 和 deprecated
- `list()` 的过滤层是 `index.json`（tags/types 匹配都打在 IndexEntry 上），返回体才回读 .md 全文——手工清洗/直改 .md 数据区时须同步 index（`rebuildIndex()` 或同改 index.json），否则过滤口径与文件内容漂移（#614 存量 tags 清洗同步了两边）；普通 `query()` 同理先信 index 元数据（含 tokenCount），外部手改 .md 而不更新 index 的漂移口径不因此扩大
- tag 写入纪律（#614 审计）：凡 append tag 处先判存在或走 Set 去重——`audit.ts`/`ingest.ts` 的 low_quality 有 includes 闸、ingest 合并走 `new Set`、`lifecycle.checkSkillCandidate`/`checkConstraintCandidate` 由前置谓词挡住重复；下游消费方侧 rule-scanner/pattern-miner 曾因缺闸造成实盘 tags 千次重复腐蚀
- 仍有两处按**原始** `referencedBy.length` 判定，不属飞轮指标、ADR-0013 明确列为范围外：`lifecycle.ts` 的 signal 饱和 / reference 激活（退役阈值调整另票）、`knowledge health` 的 D1「verified 零引用」线索提示（逐条 issue 线索，非聚合分子）
- 仍在的逐条写点（#134 记名，另票评估）：`lifecycle.recordReference()`（逐事件调用，返回更新后条目并触发回调——query 引用记账已改走 `recordReferences` 批量形，本条只剩逐事件单调用方语义）、`ingest.mergeEntries()`（单条摄入的 merge 写点；ingestBatch 的批量写已于 D7 统一走 saveAll）；`store.list()` 每条一次 `findFile()` 线性扫索引的 O(N²) 按 #134 裁决**未动**，待把知识树实际规模重新量一次再判是否单开票
