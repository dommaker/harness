# ADR-0004: 退役并删除 ConstraintInterceptor 第二执行引擎

- 日期：2026-08-19
- 状态：已接受
- 影响版本：1.2.0

## 背景

`ConstraintInterceptor`（`src/core/constraints/interceptor.ts`，217 行）把 ConstraintChecker 的核心逻辑（触发条件匹配、级别排序、铁律失败抛 `ConstraintViolationError`）重写了一遍，形成与 checker 并存的第二套执行引擎。架构评审（2026-08-19，候选2）确认：

1. **生产零调用方**：CLI 不用、gates 不用、studio 不用（studio 代码中的 interceptor 均为前端 axios 拦截器，无关）；唯一调用方是它自己的两个测试文件。
2. **隐藏前提无类型保障**：其 `constraint.check(context)` 回退路径依赖 `getConstraints()` 每次调用时向共享全局定义表装配 `.check` 函数的副作用，该前提无任何静态检查。
3. **ADR-0003 已摘公共面并留尾**：包根导出收敛时（61671ab）interceptor 族仅从包根摘出、经 `./core` 子路径保留，明确「退役单独立项」——本 ADR 即该立项的兑现。

## 决策

整体物理删除，无 deprecated 过渡期：

- 删 `src/core/constraints/interceptor.ts` 及其两个测试文件（`src/__tests__/interceptor.test.ts`、`src/core/constraints/__tests__/interceptor.test.ts`）。
- 删 `src/types/enforcement.ts` 全套 executor 类型（`EnforcementId`/`EnforcementExecutor`/`EnforcementContext`/`EnforcementResult`/`InterceptionResult`）——仅服务 interceptor API，无其他消费方。
- 摘除 `core/constraints/index.ts` 与 `core/index.ts` 中的相关再导出，`types/index.ts` 去掉 `export * from './enforcement'`。
- 拦截语义由唯一入口 `checkBeforeExecution`（checker.ts）承担：铁律违规抛 `ConstraintViolationError`，与 `interceptor.claim` 语义等价，且已有测试覆盖。

**关闭的扩展路线**：「用户注册自定义 executor 覆盖内置检查」能力随删除消失。该注册的实现未走 ADR-0002「定义表 + 注册表 + 构建期校验」规范；未来如需重开此路线，须按 ADR-0002 范式重新设计，不恢复旧实现（git 历史可考）。

## 理由

- 删除判据与 ADR-0003 一致：生产断链 + 与已接线实现重复，消费面为零是结果不是原因。
- deprecated 标在无人 import 的模块上是形式主义；ADR-0003 已建立「零调用方断链代码直接删」的先例（`refactor(exports)!:`）。
- 执行逻辑回归单份，以后改触发匹配/级别排序/铁律抛错只改 checker 一处。

## 明确不做

- `getConstraints()` 运行时向共享定义表装配 `.check` 的副作用不在本 ADR 范围（删 interceptor 只去掉该副作用的「受益者」），由后续候选单独处理。
- 版本号与 CHANGELOG 由发布流程（harness-ship）管理。
