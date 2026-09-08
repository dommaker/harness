# ADR-0013: 知识飞轮指标收口——单一 flywheel-metrics 模块

- 日期：2026-09-02
- 状态：已接受
- 影响版本：随下个 patch 发布（无对外破坏：CLI JSON 形状与字段名不变，仅 stats / health 报出的数值口径变化）
- 关联：架构评审 2026-09-02 候选 2（#81）；手法对齐 ADR-0009（对照判定收口）/ ADR-0011 / ADR-0012

## 背景

`refCoverage` / `avgRefs` / `consumptionHitRate` 这组飞轮指标有三份独立实现，分子口径已分叉（复核于 #81）：

- `src/knowledge/audit.ts`：`genuineRefs()` 先过滤 synthetic 引用键（`search|test-agent|prompt-inject|monitor|analyst|auditor|triage|executor|session|trend|incident:<date>`）再计数，D6 与 D4 的 orphan-draft 判定都用过滤后的值
- `src/cli/commands/knowledge.ts` 的 `knowledge stats` 与 `knowledge health`：直接数 `entry.referencedBy.length`

真实库实测（170 条 active）：同一知识库 `audit` 报 refCoverage 26% / avgRefCount 0.4，`stats` / `health` 报 28% / 0.6——`avgRefs` 相差 50%。库内 164/204 条目带 `referencedBy`，其中大量是自动化按天记账（`recordReference()` 的 `${contributor}:${YYYY-MM-DD}` 键），原始计数口径下自动化触碰被算成真实消费。飞轮指标是退役/降级判定的输入，口径分叉即治理决策建立在两个事实上。这不是重复代码问题，是已发生的语义漂移。

## 决策

新增 `src/knowledge/flywheel-metrics.ts`（包内模块，不进 `src/knowledge/index.ts` 与包根导出面，对齐 ADR-0009/0012 先例）：

- `evaluateFlywheel({ entries, dailyConsumptionEvents? })` → canonical 指标对象（`activeEntries` / `entriesWithRefs` / `refCoverage` / `avgRefs` / `dailyConsumptionEvents` / `consumptionHitRate`）。纯函数、零 IO：人口筛选（谁是 active）与 `.consumption-stats.json` 读取都留在调用方，module 只出比例（0..1），不碰单位。
- `genuineRefs()` 与其正则从 audit.ts 迁入，成为唯一口径。**canonical 分子 = 过滤 synthetic 后的 genuine refs**（triage 裁决）。依据：过滤规则自带的意图注释（自动化 search/ops 记录非真实消费）；synthetic 前缀对应自动化写入方且按天滚动记账；审计引擎内部本已一致（D6 与 orphan-draft 同用过滤值），是 stats/health 两个展示层漏跟；退役/降级判定不应被自动化触碰续命。
- 三个消费方全部改从该 module 取数：audit D6（含 D6 评分公式的入参）、`knowledge stats`（完整三元组）、`knowledge health`（summary 子集）。展示层自行做单位与字段名映射：百分比取整、avgRefs 一位小数；audit 报告层的呈现名 `avgRefCount` 在其报告形状内保留，不改对外字段。
- 同源不同切片：三处喂给 module 的条目人口各自保留（stats 与 audit 取非 archived，health 取 `excludeArchived` 切片），统一的是计算不是人口。
- 保持不动（范围外）：
  1. `KnowledgeQuery.query()` 注入路径写入的 `unknown:` 键——维持「注入即消费」，不扩大过滤面。
  2. `consumptionHitRate` 公式（`dailyEvents / active` 数、capped at 1）——只同源，不重定义。
  3. 生命周期/退役阈值（`lifecycle.ts` 的 `referencedBy.length` 判定）——随 ADR-0009 手法另行处理。
  4. `doctor.ts` 的 `KnowledgeHealthScorer`——不涉 refs 口径。
  5. `knowledge health` 的 D1 逐条「verified 零引用」提示与 `constraints retire` 的空 `referencedBy` 写入——前者是 issue 线索不是聚合指标分子（triage：health 沿用自身的 issue 检查），后者不构成第四消费方。

## 理由

- 治理决策的输入只能有一个事实：分子从此只有一份代码，「同口径靠注释」这一类同步点结构上消灭。
- deletion test 通过：删掉该 module，比例计算不会消失，只会以三份回归——正是现状。
- interface 即测试面：canonical 指标可从纯数据旁测（无 fs fixture），跨消费方一致性有真实库 fixture 钉住（同一 fixture 三处取数逐字段相等）。

## 影响

- `knowledge stats` / `knowledge health` 报出的 `refCoverage` / `avgRefs` 相对修复前下修（去掉自动化触碰），与 `knowledge audit` D6 对齐——这是本票要的行为变化，不是回归。对外 JSON 形状、字段名、单位（百分比整数 / 一位小数）逐字不变。
- 新增 `src/knowledge/flywheel-metrics.ts` + `__tests__/flywheel-metrics.test.ts`（纯函数旁测）+ `src/cli/commands/__tests__/knowledge-flywheel-consistency.test.ts`（三处同源一致性）；`src/CONTEXT.md` 术语表与 `src/knowledge/CONTEXT.md` 记「飞轮指标只有一个实现」。
- audit 报告、D6 评分、`harness knowledge audit` 输出数值不变（其口径本就是 genuine 过滤后）。
