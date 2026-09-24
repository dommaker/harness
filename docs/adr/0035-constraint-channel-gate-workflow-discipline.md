# ADR-0035: 约束 channel 通道——gate/workflow/discipline 两轴模型，注册表闭环收窄到 gate

- 日期：2026-09-24
- 状态：已接受
- 关联：harness#180（实施票）；studio#640（Phase 2 违规代理计数，消费方）；harness#174（预设落地时点："schema 变更待 evolution 晋升机制落地时一并做"）；ADR-0029（注册表闭环措辞由本 ADR 收窄）；ADR-0033（两层约束模型，discipline 条目走应用层 `.harness/constraints.yml` 登记）；ADR-0001（闭环语义本体）

## 背景

纪律规则（无 checker 的文本规则）需要登记进约束名册，作为「计数→阈值→晋升提案→人审→毕业」机制的读写落点（studio#640 前置）。ADR-0029 的注册表闭环口径是「全部约束 kind='check'、必须带 checker」，不允许无 checker 的约束存在——这条口径在文本注入层关停后需要一个不复活注入层的开口：条目只是名册里的数据记录，不渲染、不注入、不执行。

## 决策（两轴模型）

**通道（后果轴）**与**探测器来源（判定轴）**正交。本 ADR 只动后果轴。

1. **`Constraint.channel` 三值枚举，缺省 `gate`**（现有行为零变化，非 breaking）：
   - `gate` = 硬门禁：带 checker、违规按 severity 阻断/告警（现有全部规则的通道）
   - `workflow` = 流程机制承载：无 checker，由 CI/拆票等流程结构兜住
   - `discipline` = 拦不住但数得出：无 checker 的登记记录，harness **永不渲染、永不注入、永不执行**，供消费方（studio）做代理信号计数；超阈值晋升毕业后原地翻 channel 回 gate（补上 checker）
2. **注册表闭环收窄为「gate 通道的规则必须带 checker」**：checker 必填条件从「全部约束」收窄到 `channel='gate'`；非 gate 条目不进入 checker 分发（编排层在 error/warning 两级循环与 beforeExecution/findApplicableConstraints 同口径过滤），不触发闭环抛错。discipline 条目不是 ADR-0029 要杀的「文本注入」——注入层已关停，它只是名册里的数据记录。
3. **探测器来源三档方向登记**（判定轴，本票不动工）：内置 checker / 模板填参（ADR-0033 TEMPLATES）/ exec 自定义脚本。exec 口子等第一张模板填不了的晋升提案出现时另立票，不预先开口。
4. **缺省解析唯一口径**：`isGateConstraint`（`core/constraints/definitions.ts`）= `(channel ?? 'gate') === 'gate'`，检查分发与加载期闭环校验共用；应用层条目由 loader 显式落 channel 值，消费方可直接按 `channel` 字段分桶。

## 否决的备选

- **复活文本注入层承载纪律规则**：被否决。ADR-0029 关停注入层的裁决不变；discipline 条目是数据记录，harness 侧零渲染零注入，消费方自行读取计数。
- **无 checker 约束一律禁止（维持 ADR-0029 原口径）**：被否决。晋升机制需要「先登记计数、后毕业带 checker」的中间态，名册是这个中间态的唯一读写落点；禁令会把计数机制逼到名册外的私有台账，丢掉 git 评审与 CI 可读性（ADR-0033 决策 1 的同一理由）。

## 影响

- `src/types/constraint.ts`：新增 `ConstraintChannel` + `Constraint.channel?`（缺省 gate），公共导出面（包根 / core / constraints 三处显式清单，ADR-0003）同步。
- 内置 7 条定义全部显式标 `channel: 'gate'`；加载期注册表闭环校验与编排层分发按 gate 过滤。
- 应用层 `.harness/constraints.yml`：`checker` 仅 gate 通道必填；非 gate 条目允许无 checker，填写了仍按模板校验；非法 channel 值加载期抛错。
- ADR-0029 的闭环措辞以本 ADR 为准收窄（该 ADR 正文留修订记录，不改写历史）。
- 范围外：exec 自定义检查器口子（另立票）；studio 侧采集/计数/提案/生效实现（studio#640 本体）；workflow 通道条目的流程承载机制。
