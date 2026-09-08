# ADR-0016: 约束判定自带证据，且只对「本次变更有因果」的缺口判违规（#119）

- 日期：2026-09-08
- 状态：已接受
- 影响版本：下个 minor（1.5.0）—— 公开类型 `ConstraintCheck.evaluate` 返回面扩为 `CheckOutcome`（新增 `CheckDetail` 形状），`ConstraintResult` / `ExecutionTrace` 新增可选 `evidence` 字段；行为变更见「影响」
- 关联：#119（本票）；ADR-0009（覆盖/幽灵判定单一来源，本 ADR 只改归因与出口，不动判定）；ADR-0001（skip 三态，本 ADR 给它加了「第四形状」但不新增统计态）；前置事故记录 2026-08-08 studio CI 4 连红（docs_freshness 当时的 console.error 侧信道即本 ADR 要收口的对象）

## 背景

约束快照（studio-config/reports/harness/constraints-20260908.md）报 `capability_sync` fail 率 100%（20/20），标为「高噪·疑似误报源」。逐条查实（studio 仓 22 条 trace 全 fail、复现于 `harness check --trigger module_modification`）：

1. **判定本身没错**：当时 studio 确有一个文件未登记——`apps/api/src/modules/review-proposal/routes.ts`（#351 同目录另 4 个文件都登记了，只漏它）。file 模式 Step 2 要求源码根下每个 `.ts` 都在 CAPABILITIES.md 有行。
2. **但 100% 这个数字不是「代码持续违规」，是归因错位**：Step 2（T-058 全量扫描）是**仓库级完备性不变量**，与正在被评估的那次变更没有因果关系。一处历史漏登会让它之后每一次 `module_*` 评估都红——缺口一日不补，fail 率一日 100%。
3. **红在哪无法知道**：checker 只回 `boolean | 'skip'`。CLI 打印的是约束定义里的静态 message，trace 记录只有 `{constraintId, result, operation}`。票面问「fail 的具体 message / 证据是什么」——现状答案是「没有」：定位这一个文件要靠手工重写一遍判定逻辑跑脚本。
4. **同一判定早有带证据的出口**：`harness sync-docs --check` 在 studio 直接输出 `CAPABILITIES.md 缺少以下模块: + routes.ts`，缺登记时 exit 1，studio CI（`.github/workflows/ci.yml`）已跑这一步。也就是说完备性本就有执法处，checker 的 Step 2 是重复实现 + 挂错接缝。
5. `docs_freshness` 在 2026-08-08 撞过同一堵墙，当时的办法是 `console.error` 打幽灵条目——侧信道：进不了 CLI 结构化输出，更进不了 trace，而它是铁律，违规时直接 throw，用户只见一句通用提示。

## 决策

### 1. `CheckOutcome` 扩第四形状 `CheckDetail`，判定与证据同处返回

```ts
interface CheckDetail { pass: boolean; evidence?: string[] }
type CheckOutcome = boolean | 'skip' | CheckDetail
```

- 证据行由 **checker 自行措辞**（每行自描述，如 `变更文件未登记: src/foo.ts`），消费端只负责缩进与着色，不解释内容——否则文案与证据形状会在 checker / CLI 两头漂移。
- `normalizeCheckOutcome()` 是**唯一归一点**（编排层与 `gates/checker-gate` 都只消费归一形状）；`formatEvidence()` + `MAX_EVIDENCE_ITEMS=10` 与类型同住 `checkers/types.ts`，截断策略单点。
- 旧形状 `boolean` 继续接受，外部 checker 实现不受影响。skip 恒不携带证据（未评估不得留下看起来像结论的行）。

### 2. 证据贯通四个出口

| 出口 | 落点 |
|---|---|
| `ConstraintResult.evidence` | 结构化结果，包根导出类型 |
| `harness check` 输出 | 违规块内缩进跟随；**通过但带证据 → 独立「💡 提示」块**，不改 exit code |
| `ExecutionTrace.evidence` | trace JSONL（对 trace 头「不记录代码片段」原则记一条例外：路径级依据不是代码片段，没有它恒红约束根本无法复盘） |
| `ConstraintViolationError.message` | 铁律违规在 `checkConstraints` 处直接 throw，CLI 的结构化块走不到——异常文案是铁律证据唯一的外溢面 |

### 3. `capability_sync` 按因果分层

- **Step 1（staged 增量未登记）→ 判违规**，证据点名是哪些变更文件。
- **Step 2（全量完备性）→ 不判违规，只出提示**。执法收归 `harness sync-docs --check`（CI 已跑、缺登记 exit 1、输出本就带文件名）。
- 「有表格但零条目」的文档退化门**保留为违规**，但不再借 Step 2 兜——显式化（这是文档被清空，与「某个新文件没登记」不是一回事）。
- 判定规则（`isCoveredBy`、目录条目恒参与、listing 短路、散文放行、fail-open+warn、存在性 skip）逐条不动，ADR-0009 的单一来源地位不动。

### 4. `docs_freshness` 侧信道下线

幽灵条目与 Runner 失败项都改走证据通道，`console.error` 删除。判定条件与失败面逐条不变（只是从「说不清」变成「说得出」）。

不选「拆独立 constraint id（如 `capability_completeness`）」：要为一条提示新增生效集/注入/统计形状，代价大于收益；输出侧的「违规 / 提示」分层与 trace 的 `result` 字段已把两类信号分开计量。
不选「只加证据、保留 Step 2 fail」：缺口补上前 fail 率仍是 100%，信号照样不可信——高噪判据（evolution / constraints report）读的就是这个比率。
不选「studio 切 `governance.capabilities.mode: module`」（2026-08-08 评估方案 A 的收尾项）：实测切了仍 fail，只是聚合成 `apps/api/src/modules/review-proposal/` 一个目录名——mode 选择是 studio 的文档策划制问题，不解决归因，留作 studio 侧独立决策。

## 理由

- **约束的 fail 必须可归因到被评估的对象**。挂在 per-change 接缝上的检查，若结论可以完全由与本次变更无关的历史状态决定，那它统计出的就不是「这次做得对不对」，而是「仓库历史上欠了几笔」——两者都该有出口，但不能共用一个 pass/fail 位。
- **零证据的约束等于不可治理的约束**：100% fail 率两周无人能说出红在哪，进化侧（E1 约束进化）拿到的是「高噪，疑似误报」这种无从下手的结论；补上证据后同一个数字读作「缺 1 个文件，跑 sync-docs」。
- **一份判定只留一个执法处**：完备性已由 `sync-docs --check` 在 CI 拦（exit 1），checker 再拦一次只是把一个仓库级事实重复计入每一次变更评估。

## 影响

- 代码：`checkers/types.ts`（新增 `CheckDetail`/`NormalizedOutcome`/`normalizeCheckOutcome`/`formatEvidence`）、`checker.ts`（归一 + trace 带证据）、`checkers/capability-sync.ts`（分层）、`checkers/docs-freshness.ts`（证据替侧信道）、`cli/commands/check.ts`（证据行 + 提示块）、`gates/checker-gate.ts`（deny 理由带证据，并修掉 `outcome !== false` 对新形状的误判）、`types/{constraint,trace}.ts`。
- 公开面：`CheckOutcome` 联合类型扩支、`ConstraintResult.evidence` / `ExecutionTrace.evidence` 新增可选字段——均为向后兼容的扩面，旧 boolean 与不读新字段的消费方（studio、constraints report、evolution）不受影响。
- 行为：**studio 侧 `capability_sync` 从恒红转绿**（历史漏登不再判违规，只出提示）；fail 的语义收窄为「本次 staged 变更里有未登记文件」，因此约束统计里它的 fail 率不再等价于「文档是否干净」——读历史统计（2026-07 起的 22 条 fail）时要按新口径理解，历史数据不回填。
- 文档：`src/CONTEXT.md` 术语表加「判定证据 / 提示」，`src/core/CONTEXT.md` 与 `CAPABILITIES.md` 的 Constraint Model 段随之更新。
- 本 ADR 不解决：studio 的 `capabilities.mode` 缺省选择（另票）；`context_doc_sync` 等其他 checker 的证据补写（仍是裸 boolean，接缝已就位）；Step 1 用 staged 名单而 `sync-docs --check` 用全量名单的口径差（两者职责不同，暂不统一）。
