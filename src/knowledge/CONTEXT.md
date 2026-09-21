# knowledge/

## 职责
知识引擎：知识存储(CRUD)、语义查询、引用追踪、质量审计(Audit)、质量检查(Linter)、生命周期管理、冷启动导入、健康评分、外部内容摄入。

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
- `KnowledgeStore`（类型面）/ `FileKnowledgeStore`（`store.ts`，barrel 与包根交出的**值**符号——store 的文件系统实现，构造收 `{ baseDir }`；仓内构造点两处：`cli/commands/knowledge-view.ts` 的 `openKnowledgeStore()`（knowledge 各子命令的取数口）与 `cli/commands/constraints-retire.ts` 的退役沉淀写入）— 知识条目 CRUD + 结构化存储；`saveAll()` 全量批量写入（循环内只更新内存索引、结束一次 writeIndex，harness#107）、`applyAll()` 按 id 部分更新的批量出口（`update(id, partial)` 的批量形，语义含未知 id 逐条跳过与空批零读写，harness#134）、`getConsumptionStats()` 读 `.consumption-stats.json` 的当日消费计数（打分核心唯一的消费统计取数口，harness#134）。**写入闸（E1 复盘修正 M1）**：save/saveAll/applyAll 落盘前校验 maturity/layer 枚举（update 经 save 继承），未声明值拒写抛错不静默降级；值域正本 = `types.ts` 的 `MATURITY_LEVELS`/`STORAGE_LAYERS` 常量（不进 barrel）。批量路径先整批预校验再落盘（任一脏值全批拒写）；applyAll 批内同 id 多条按序累积合并语义不变
- `KnowledgeQuery` — 语义搜索 + 类型/标签过滤 + `queryByMode()` + `consume(taskContext)`；`query()` 是 budget 截断管线（仅用于 prompt 注入），`search()` 是全语料文本搜索（先匹配→排序→limit，交互搜索专用，勿用 query() 代替）
- `KnowledgeLifecycle` — per-mode 生命周期管理；缺省阈值常量 `DEFAULT_DECAY_CONFIG`（`provenDecayMonths: 12` / `verifiedDecayMonths: 6` / `draftDecayMonths: 3` / `autoPromoteSources: []`，正本 `types.ts`）经构造器 `{...DEFAULT_DECAY_CONFIG, ...config}` 合并，barrel 与包根一并交出
- `extractCodeStructure(dir)`（`primitives/code-structure.ts`，配 `CodeStructure`/`DeclarationInfo`/`ImportInfo` 三类型对外）— 目录代码结构提取；仓内零调用方，是留给下游的公开面
- `KnowledgeIngest` — 知识摄取引擎（含 ingest gate 质量门）+ `ingestExternal()` 外部内容摄入
- `sanitizeExternalContent` — 外部内容安全清洗（过滤注入模式 + 长度限制）
- `migrateKnowledgeEntries` — AS-021 迁移工具（为现有条目添加 consumptionMode/origin）；条目人口按 `tree-walker` 口径判定，`_index.md` 等树生成物不计入 `total`/`errors`（harness#134 修此前假阳性）
- `KnowledgeAudit` — 7 维度质量审计**引擎**：构造收 `KnowledgeStore`（与 lint / doctor / query / lifecycle / ingest 同形，harness#134——此前收目录并自建 store，致使打分判定无法脱离文件系统测试）+ 可选阈值形参（三个数值槽显式传 NaN/±Infinity/负数时构造期抛 `TypeError`（message 含槽名与实参），不放行到打分层静默关掉 short-content/stale-entry/promotion-blocked 三条判定；未传/显式 `undefined` 走缺省、显式 `0` 合法按 0 生效，harness#163）。职责只剩装配：取条目、经 store 取环境数据、把整批修复动作交 `store.applyAll()`。per-entry 规则记录带 `scope: 'active' | 'all'`（active = 不判定 archived 条目）；人口过滤由 `ruleDetail()` 统一执行，规则内禁止再写 `entry.maturity === 'archived'` 早返回。规则中文 label 正本在规则定义的 `label` 字段（harness#109，ADR-0002 定义即注册），`AUDIT_RULE_LABELS` 派生导出、与 `AuditRuleName` 编译期闭环，CLI 展示层直接消费、禁止另建 label 表
- `audit-scoring`（**值面**不进导出面；类型面是例外——`AuditRuleName`/`AuditAction`/`AuditIssue`/`AuditReport`/`AuditOptions` 经 `index.ts` 再导出并上包根，ADR-0003 显式清单）— D1–D7 打分**纯模块**（harness#134）：规则表、`scanEntries()` / `summarizeIssues()` / `computeDimensions()` / `calculateHealthScore()`，零 fs——环境数据（消费统计、快照存活）由调用方经 store 取好喂入。审计判定的唯一正本在此，可脱离合建目录测试
- `tree-walker`（包内，不进导出面）— 知识树排除口径单点（harness#134）：`isEntryFile()` / `isInfraDir()` / `INDEX_MD_FILE` / `SNAPSHOTS_DIR`，由 store 顶层扫描、migration 顶层扫描、index-generator 递归扫描三处共同消费
- `flywheel-metrics`（包内，不进导出面）— 知识飞轮指标唯一实现：`evaluateFlywheel(env)` 出 canonical 比例、`genuineRefs()` 出 synthetic 过滤口径，audit D6 / `knowledge stats` / `knowledge health` 三处共消费（ADR-0013）
- `ReferenceTracker` — 知识引用关系图谱
- `KnowledgeLinter` — 知识质量检查(完整性/一致性/时效性)；maturity/layer 枚举校验两个入口共用判定正本 `invalidEnumIssues`：`run()` 经 `checkInvalidEnums()` 扫存量（缺字段即脏、issue 带 entryId，`invalid_enum` 无 autoFix 分支——映射需人工裁定），`validateEntry()` 管摄入前（字段缺省跳过以兼容只传四字段的 pre-ingest 调用方）
- `ColdStartImporter` — 冷启动知识导入
- `KnowledgeHealthScorer` — 知识健康评分（doctor.ts）

## 依赖关系
- 知识类型正本在**本模块** `src/knowledge/types.ts`（`KnowledgeEntry`/`MaturityLevel`/`ConsumptionMode`/`KnowledgeOrigin`/`DecayConfig`…）；本目录对 `src/types/` **零 import**——旧条目「依赖 `src/types/` 知识相关类型」不实（harness#142 逐条核对）
- 依赖 `src/utils/frontmatter` — markdown frontmatter 解析/序列化的唯一正本（harness#89：store、migration、index-generator、ingest 共用同一套语法判定，不再各写正则）
- 不依赖 `src/context/`（原 `lifecycle-hooks.ts` 是唯一 import `context/types` 的文件，已随 ADR-0022 删除），也不依赖 monitoring——知识健康评分由本目录 doctor.ts 的 KnowledgeHealthScorer 承载
- 被 `src/cli/commands/knowledge.ts` CLI 消费（含 `migrate` 子命令）

## 约定
- 知识条目文件的 frontmatter 语法只由 `src/utils/frontmatter` 定义（harness#89）：缺头/空 meta = `absent`（合法输入，按非条目静默处理、不上报——migration 对 `absent` 不计 `errors`、不迁移，只计 `skipped` 保证 `total` 计数闭环，harness#161 对齐 #89 裁决 2）；未闭合/YAML 非法 = `malformed`（必须显式上报后按消费方语义恢复——migration 落 `errors`、store 与 index-generator 打一行 stderr 后跳过或走 best-effort），禁止静默丢条目；canonical 字段序是 `store.toFrontmatter` 的私有策略，`join` 只管包裹格式
- **知识树的排除口径只有一个正本 `tree-walker`**（harness#134）：`_index.md`（索引生成物）、`.snapshots`、`.archive` / `archived`、`resolutions` 是树基建、不是条目人口。store 与 migration 的顶层扫描、index-generator 的递归扫描三处都走它；新增 walker 禁止另立排除清单。统一的是**排除口径**不是遍历深度（store/migration 顶层、index-generator 递归）。例外须原地记名理由：`import.ts` 的 docs 扫描吃的是**项目文档树**，本口径在它那里没有对应物
- **循环内禁止逐条 `store.update()`**（harness#134）：`update()` 的形状是 get→save、`save()` 每次全量重写 index.json，N 条修复 = N 次全量重写。批量形是 `applyAll(id → partial)`；一次 `audit --fix`、一轮 `runDecayCycle()`、一次 `updateReferencedBy()` 各只重写一次索引，计数闸见 `audit-write-count.test.ts` 与 `lifecycle.test.ts` / `reference-tracker.test.ts` 的 stringify 计数项
- **写入闸不管读**（E1 复盘修正 M1）：枚举校验只在 save/saveAll/applyAll/update 落盘前执行，读取（parseFile）不校验——盘上脏条目可读可列，但任一写入路径触及即抛错（含「只改其他字段」的部分更新），先修脏值再写；绕过本 store 直写文件的外部写入方不受闸约束
- **审计判定脱离文件系统可测**（harness#134）：规则表与 D1–D7 打分住 `audit-scoring.ts`，零 fs（源形状闸钉在 `audit-scoring.test.ts`）；引擎 `audit.ts` 只做 store 装配，环境数据经 `store.getConsumptionStats()` / `getSurvivalRate()` 取好喂入
- 知识条目有明确的生命周期状态（按 consumptionMode 分化）
- 约束退役（`harness constraints retire`，人确认）时写入 KnowledgeStore：规则原文 + 退役原因 + 历史统计
- Linter 检查完整性/一致性/时效性三个维度
- Audit 7 维度评分：D1结构 D2内容 D3去重 D4成熟度 D5新鲜度 D6飞轮 D7增量存活
- Ingest gate: ingestEntry() 先经 audit.validate() 检查，reject 不入库
- 外部内容三层防御：ingest sanitization + retrieval marking + prompt constraint。第二层 marking 已接线（harness#161）：标记正本是 `knowledge/query.ts` 的 `EXTERNAL_SOURCE_MARKER` 常量（`[External Source — verify before acting]`），`KnowledgeQuery.formatForPrompt()` 与注入路径 `context/knowledge-injector.ts` 的 `formatEntry()`/`formatEntrySummary()` 共用同一常量——`origin === 'external'` 条目注入 prompt 时带来源前缀，注入 source 的 metadata 带 `origin`。第三层（prompt constraint）在本仓不可核（属 studio/agent 侧提示词），未核不改
- 消费饱和度替代固定 TTL 用于 signal 过期判断
- **飞轮指标只有一个实现**（ADR-0013）：`refCoverage` / `avgRefs` / `consumptionHitRate` 一律出自 `flywheel-metrics.evaluateFlywheel()`，canonical 分子 = `genuineRefs()` 过滤后的真实消费引用（`search|test-agent|prompt-inject|monitor|analyst|...:<date>` 自动化按天记账键不算消费，`unknown:` 注入键算消费）。audit D6 / `knowledge stats` / `knowledge health` 只在展示层做单位与字段名映射（百分比取整、一位小数、`avgRefs`→`avgRefCount`），人口筛选留在各调用方。新增消费方禁止自行数 `referencedBy.length`。

## 注意事项
- Phase 1+4 实现的知识引擎核心
- 约束"退役不删除"——retire 落盘 config.yml `enabled: false` + retired 元数据，保留规则原文 + 退役原因 + 历史统计（可回滚）
- `MaturityLevel` / `StorageLayer` 的值域不抄清单——运行时正本是 `types.ts` 的 `MATURITY_LEVELS` / `STORAGE_LAYERS` 常量（写入闸与 lint 枚举校验共用）
- `excludeArchived` 同时排除 archived 和 deprecated
- 仍有两处按**原始** `referencedBy.length` 判定，不属飞轮指标、ADR-0013 明确列为范围外：`lifecycle.ts` 的 signal 饱和 / reference 激活（退役阈值调整另票）、`knowledge health` 的 D1「verified 零引用」线索提示（逐条 issue 线索，非聚合分子）
- #134 收口后仍在的逐条写点（同型问题，本票裁决点名的循环之外，需要时另票）：`lint.ts` 的三处 autoFix `store.update()`、`lifecycle.recordReference()`（逐事件调用，返回更新后条目并触发回调，批量化会改它的契约）、`ingest.mergeEntries()`；`store.list()` 每条一次 `findFile()` 线性扫索引的 O(N²) 按 #134 裁决**未动**，待把知识树实际规模重新量一次再判是否单开票
