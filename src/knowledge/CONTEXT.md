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
- `KnowledgeStore` — 知识条目 CRUD + 结构化存储；`saveAll()` 批量写入（循环内只更新内存索引、结束一次 writeIndex，harness#107）
- `KnowledgeQuery` — 语义搜索 + 类型/标签过滤 + `queryByMode()` + `consume(taskContext)`；`query()` 是 budget 截断管线（仅用于 prompt 注入），`search()` 是全语料文本搜索（先匹配→排序→limit，交互搜索专用，勿用 query() 代替）
- `KnowledgeLifecycle` — per-mode 生命周期管理
- `KnowledgeIngest` — 知识摄取引擎（含 ingest gate 质量门）+ `ingestExternal()` 外部内容摄入
- `sanitizeExternalContent` — 外部内容安全清洗（过滤注入模式 + 长度限制）
- `migrateKnowledgeEntries` — AS-021 迁移工具（为现有条目添加 consumptionMode/origin）
- `KnowledgeAudit` — 6 维度质量审计引擎。per-entry 规则记录带 `scope: 'active' | 'all'`（active = 不判定 archived 条目）；人口过滤由 `ruleDetail()` 统一执行，规则内禁止再写 `entry.maturity === 'archived'` 早返回
- `flywheel-metrics`（包内，不进导出面）— 知识飞轮指标唯一实现：`evaluateFlywheel(env)` 出 canonical 比例、`genuineRefs()` 出 synthetic 过滤口径，audit D6 / `knowledge stats` / `knowledge health` 三处共消费（ADR-0013）
- `ReferenceTracker` — 知识引用关系图谱
- `KnowledgeLinter` — 知识质量检查(完整性/一致性/时效性)
- `ColdStartImporter` — 冷启动知识导入
- `KnowledgeHealthScorer` — 知识健康评分（doctor.ts）
- `KnowledgeLifecycleHooks` — 生命周期 hook

## 依赖关系
- 依赖 `src/types/` 知识相关类型
- 依赖 `src/utils/frontmatter` — markdown frontmatter 解析/序列化的唯一正本（harness#89：store、migration、index-generator、ingest 共用同一套语法判定，不再各写正则）
- 依赖 `src/context/types`（ContextUsageSnapshot 等类型；不依赖 monitoring——知识健康评分由本目录 doctor.ts 的 KnowledgeHealthScorer 承载）
- 被 `src/cli/commands/knowledge.ts` CLI 消费（含 `migrate` 子命令）

## 约定
- 知识条目文件的 frontmatter 语法只由 `src/utils/frontmatter` 定义（harness#89）：缺头/空 meta = `absent`（合法输入，按非条目静默处理）；未闭合/YAML 非法 = `malformed`（必须显式上报后按消费方语义恢复——migration 落 `errors`、store 与 index-generator 打一行 stderr 后跳过或走 best-effort），禁止静默丢条目；canonical 字段序是 `store.toFrontmatter` 的私有策略，`join` 只管包裹格式
- 知识条目有明确的生命周期状态（按 consumptionMode 分化）
- 约束退役（`harness constraints retire`，人确认）时写入 KnowledgeStore：规则原文 + 退役原因 + 历史统计
- Linter 检查完整性/一致性/时效性三个维度
- Audit 6 维度评分：D1结构 D2内容 D3去重 D4成熟度 D5新鲜度 D6飞轮
- Ingest gate: ingestEntry() 先经 audit.validate() 检查，reject 不入库
- 外部内容三层防御：ingest sanitization + retrieval marking + prompt constraint
- 消费饱和度替代固定 TTL 用于 signal 过期判断
- **飞轮指标只有一个实现**（ADR-0013）：`refCoverage` / `avgRefs` / `consumptionHitRate` 一律出自 `flywheel-metrics.evaluateFlywheel()`，canonical 分子 = `genuineRefs()` 过滤后的真实消费引用（`search|test-agent|prompt-inject|monitor|analyst|...:<date>` 自动化按天记账键不算消费，`unknown:` 注入键算消费）。audit D6 / `knowledge stats` / `knowledge health` 只在展示层做单位与字段名映射（百分比取整、一位小数、`avgRefs`→`avgRefCount`），人口筛选留在各调用方。新增消费方禁止自行数 `referencedBy.length`。

## 注意事项
- Phase 1+4 实现的知识引擎核心
- 约束"退役不删除"——retire 落盘 config.yml `enabled: false` + retired 元数据，保留规则原文 + 退役原因 + 历史统计（可回滚）
- `MaturityLevel` 包含 6 个值: draft/verified/proven/archived/active/deprecated
- `excludeArchived` 同时排除 archived 和 deprecated
- 仍有两处按**原始** `referencedBy.length` 判定，不属飞轮指标、ADR-0013 明确列为范围外：`lifecycle.ts` 的 signal 饱和 / reference 激活（退役阈值调整另票）、`knowledge health` 的 D1「verified 零引用」线索提示（逐条 issue 线索，非聚合分子）
