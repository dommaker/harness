# ADR-0006: 删除 checkConstraintsSafe 与 getConstraints() 的 .check 装配副作用

- 日期：2026-08-19
- 状态：已接受
- 影响版本：1.2.0

## 背景

架构评审（2026-08-19，候选6）确认 ConstraintChecker 两处冗余：

1. **`checkConstraintsSafe` 与 `checkConstraints` 逐行重复**：约 50 行执行循环抄了两遍，唯一差别是铁律失败时收集还是抛错。改触发匹配/trace 记录逻辑必须记得改两处，漏一处即 bug。
2. **`getConstraints()` 的运行时改写**：每次调用都向共享全局定义表（IRON_LAWS/GUIDELINES/PROMPTS）以及调用方传入的 customConfig 对象装配 `.check` 函数——看起来像纯查询，实际有副作用。ADR-0004 删除 interceptor（该副作用的唯一受益者）时已明确将此留待本 ADR 处理。

零消费者验证（2026-08-19，全仓 grep）：

- interceptor 已随 ADR-0004 物理删除，装配上去的 `constraint.check()` 无任何调用方（gates 中的 `.check(` 均为门禁自身方法，无关）。
- `getConstraints()` 的外部调用方只有 checker-extra.test.ts 的 S1 隔离测试，且只读取记录 key，不调 `.check`。
- `checkConstraintsSafe` 的调用方只有 checker-extra.test.ts 的一个 describe 块；studio 早已迁离（其代码注释甚至误认为该方法已在 0.13.0 移除）。

## 决策

整体物理删除，无 deprecated 过渡期：

- 删 `ConstraintChecker.checkConstraintsSafe` 类方法、包根 `checkConstraintsSafe` 快捷函数、checker-extra.test.ts 对应 describe 块（2 个测试）。
- 删 `getConstraints()` 内的 `wire()` 装配；方法变为纯选择器，返回类型从 `Constraint & { check: ... }` 收窄为 `Constraint`。
- **不**抽「私有循环 + throw/collect mode 参数」：Safe 删除后 mode 无第二调用方，为假想需求留参数分支违反 YAGNI。未来若出现收集模式需求，给 `checkConstraints` 加 options 标志即可。
- `checkConstraints(ctx)` 的签名与返回结构（对 studio 的 P0 冻结契约）不动；`beforeExecution` 不动（无缓存重置/trace 的独立语义，并入需引入第二正交标志，得不偿失）。

## 理由

- 删除判据与 ADR-0003/0004 一致：生产断链 + 与已接线实现重复，消费面为零是结果不是原因。
- `wire()` 通过 deletion test：删除后复杂度直接消失而非转移——附带消除「改写调用方 customConfig 对象」这一更隐蔽的副作用。
- 执行逻辑单份化后，触发匹配/trace 记录的修改点只剩 `checkConstraints` 一处。

## 明确不做

- `getConstraints` 保持 public（S1 隔离测试直接使用）；对外导出收窄是候选1的范围。
- 不单独发版：与 ADR-0005 等 breaking 变更攒入同一 major；版本号与 CHANGELOG 由发布流程（harness-ship）管理。
