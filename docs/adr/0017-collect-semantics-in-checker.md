# ADR-0017: 约束收集语义归宿 checker——删除 ConstraintViolationHandler 三策略模块（架构评审候选1）

- 日期：2026-09-08
- 状态：已接受
- 影响版本：1.6.0（breaking 内容按 minor 号发布，2026-09-09 人类裁决推翻原「下个 major（2.0.0）」）—— 包根删除六个公共导出符号（breaking）
- 关联：架构评审 2026-09-08 候选1（grilling 决策树已走完）；ADR-0003（公共导出显式清单，本次为裁决后变更）；ADR-0001（check/prompt 二元模型）；#104 判例（零 adapter 假想 seam 收口）

## 背景

`src/failure/constraint-handler.ts`（S4）提供 `ConstraintViolationHandler` 三种违规处理策略：BLOCK / COLLECT / SAFE_BOOLEAN。架构评审发现两层病灶：

1. **COLLECT 在唯一生产路径上制造假绿**。`harness report` 经 `executeWithCollect` 调 `checker.checkConstraints`，checker 在首个铁律违规即 `throw ConstraintViolationError`（ADR-0016：异常文案是铁律证据唯一外溢面）；handler 的 catch **丢弃 `error.result` 载荷**，合成 `ironLaws: [], guidelines: []` 的空结果——report 据此算出 `violations: []`、`passed = 全量`。铁律违规被报成全通过。且 guidelines 循环在铁律循环之后，一旦抛出连警告都是 0，假绿比表面更彻底。自有测试还把「返回空结果」钉成了规格。
2. **COLLECT 语义对真实 checker 结构上不可交付**。`ConstraintViolationError.result` 是**单条** `ConstraintResult`（首个违规铁律），不是完整 `ConstraintCheckResult`——部分累积结果（已检铁律 + 未执行的 guidelines）在 throw 时整体丢失，catch 路径在结构上补不回来。「收集所有违规不抛出」只能由 checker 自己支持。
3. **BLOCK / SAFE_BOOLEAN 全仓零生产消费者**（仅自有测试）；六个导出符号（`ConstraintViolationHandler` / `executeWithBlock` / `executeWithCollect` / `executeWithSafeBoolean` / `ViolationStrategy` / `ViolationHandlingResult`）在 studio 零引用。

## 决策

1. **checker 新增 `collectConstraints(context, customConfig?, evidence?): ConstraintCheckResult`**——与 `checkConstraints` 共享私有检查体 `runAllConstraints`，唯一差别是不 throw：铁律违规照进 `result.ironLaws`、`passed=false`，后续铁律与 guidelines 照常执行，trace 逐条照记（report 是一次真实检查执行，trace 口径与 check 一致）。
2. **`checkConstraints` 的 throw 契约逐字不动**（block 语义 = 方法本体；ADR-0016 的证据外溢面不受影响）。不选「加 options 参数切模式」：一个方法一个语义，「它什么时候抛」不应变成调用点知识。
3. **删除 constraint-handler 模块与全部六个导出符号**（包根 + failure barrel 双处；ADR-0003 显式清单裁决后变更，public-exports 守卫同步）。删除测试通过：复杂度集中到 report 调用点，假绿同步修掉；BLOCK 语义由 `checkConstraints` 本体承载，SAFE_BOOLEAN 无消费者。不留兼容壳——studio 零引用，留壳就是留一具测试还要供养的尸体（#104 判例）。
4. **report 顺手裁掉 html 格式**（~50 行内嵌 HTML/CSS 零测试断言其结构，无 locality 面；json / markdown 保留，CLI 定义表描述同步）。

## 理由

- **interface 承诺必须与 implementation 实况对齐**。COLLECT 的 interface 承诺「收集所有违规」，implementation 实际交付「吞掉证据报全绿」——这不是美学问题，是 verdict 的因果性问题，与 performance 门禁掷骰子（候选2）同族。
- **语义住在唯一能交付它的层**。收集全量违规需要控制检查循环的继续/中断，这个控制权只在 checker 手里；在 checker 外面包一层 handler，能做的只有 catch——而 catch 拿到的载荷在结构上就不够。
- **零消费者的公共面按 #104 判据收缩**。公共 interface 比真实需要宽，测试就在为假想消费者站岗；public-exports 冻结测试挡的是「悄悄改」，不挡「裁决后删」。

## 影响

- 代码：删 `src/failure/constraint-handler.ts` 与其测试；`checker.ts` 新增 `collectConstraints` + 私有 `runAllConstraints`；`report.ts` 直调并裁 html；`src/index.ts` / `src/failure/index.ts` 移除六符号。
- 公开面（breaking）：删 `ConstraintViolationHandler` / `executeWithBlock` / `executeWithCollect` / `executeWithSafeBoolean`（值）与 `ViolationStrategy` / `ViolationHandlingResult`（类型）。迁移路径 = 删引用；需要收集语义的消费者改调 `checker.collectConstraints`（返回形状即原 `ConstraintCheckResult`）。按 1.6.0 发布。
- 行为：**`harness report` 在铁律违规时如实上报**（violations 点名、failed ≥ 1、passed < total），不再是零违规全通过；report 运行会对全部触发域内约束逐条写 trace（此前铁律违规即中断，只写到违规那条）。
- 测试：新增 `report-false-green.test.ts`（假绿回归，先红后绿，真 fixture 不 mock）、`collect-constraints.test.ts`（五枚：不抛/如实/不截断/guidelines 照常/干净对照）；删 constraint-handler 规格测试。
- 文档：`src/failure/CONTEXT.md`（S4 段重写，记录删除与语义归宿）、`src/core/CONTEXT.md`（检查引擎双出口说明）；`docs/public-exports-review.md` 是 2026-08-19 历史评审快照，不回改。
