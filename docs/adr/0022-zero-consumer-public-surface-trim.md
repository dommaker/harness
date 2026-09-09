# ADR-0022: 零消费者公共面收缩——六项删除（架构评审候选6）

- 日期：2026-09-08
- 状态：已接受
- 影响版本：下个 major（2.0.0）—— 公共导出符号删除（breaking，与 ADR-0017/0018/0019 同车）
- 关联：架构评审 2026-09-08 候选6（grilling 决策树已走完）；#104 判例（零 adapter 假想 seam 收口）；ADR-0003（公共导出显式清单，裁决后变更）

## 背景

#104 以「零 adapter 假想 seam」删了 PassesGate 扩展注册表，但同型面仍在。事实核查（harness 仓内 + studio 全仓双查，区分生产/测试/barrel/类型引用）确认**六项零生产消费者**：

| 符号 | 实况 |
|---|---|
| `PassesGate.setPasses` / `getTestResult` / `checkTestFileChanges` | 三方法零生产消费者（studio 只走 `check()`，harness 只走 `runTests`）；`checkTestFileChanges` 还含死数据 `PROTECTED_TEST_PATTERNS`（passes-gate.ts:40-49 声明，:419 的 `.some(() => …)` 回调丢弃模式参数，真实匹配靠 :420-423 硬编码 includes） |
| `SessionStartup`（+ `createSessionStartup` + `DEFAULT_CODE_CHECKPOINTS`/`MINIMAL_CHECKPOINTS`） | 零生产消费者 |
| `CleanStateManager`（+ `createCleanStateManager`） | 零生产消费者 |
| `AdaptiveTokenBudget` | 零生产消费者（基类 TokenBudget 也无生产实例化点——但 TokenBudget 不在本票范围） |
| `SessionCompaction`（+ `DEFAULT_COMPACTION_CONFIG`） | 零生产消费者 |
| `KnowledgeLifecycleHooks` | 零生产消费者 |

**移出候选的两项**（事实核查推翻零消费者假设）：`ErrorClassifier`——studio `diagnostics.routes.ts:36-38` 真实消费（POST /api/v1/harness/classify），不删；`CSOValidator`——studio `cso.routes.ts:23` 名义消费（`getInstance()` 拿到实例不做任何验证，恒返回 `{valid:true}`，apps/web 无前端调用，注释失实）——端点存废是 studio 侧决策，另票评估，harness 侧暂留。

`src/__tests__/passes-gate-check.test.ts:98-100` 有 AC-007 断言「保留 setPasses() 向后兼容」——历史验收钉子；兼容承诺的对象（外部消费者）经双仓核实不存在，本 ADR 明确推翻该 AC。

## 决策

1. **删除六项**（上表），各自连带：实现文件、barrel 链（子目录 index → core/index → src/index）、public-exports.test.ts 条目、自有测试文件、CONTEXT.md 提及。`PROTECTED_TEST_PATTERNS` 死数据随 `checkTestFileChanges` 同删。
2. **PassesGate 保留面**：`check()` / `runTests()` 两个真实消费点不动——类成员实面只有这两个公开方法加 `constructor` 与私有的 `config`/`runTest`/`generateEvidence`/`verifyEvidence`（本项初稿把 `setThresholds` 列为保留面成员，是虚列：`setThresholds`/`setTimeouts` 属 `PerformanceGate`，`src/gates/performance.ts:236,243`，review A4 修正；本文件是本批新建 ADR 而非历史快照，留错即被新人照抄错名义，正是 ADR-0021 要治的病）；AC-007 用例改写为钉新形状（三方法不存在，`@ts-expect-error` 编译期钉 + 运行期原型断言双钉）。
3. **不动 ErrorClassifier / CSOValidator / TokenBudget 基类**：前两者 studio 有消费，后者虽无实例化点但作为公开基类另案评估。
4. breaking 同车 major；`docs/public-exports-review.md` 是 2026-08-19 历史评审快照，不回改。

## 理由

- **interface 比真实需要宽，测试就在为假想消费者站岗**：六项的测试文件全部随迁删除，供养成本真实可见（session-startup 甚至还有两份重复测试文件）。
- **删除测试逐项通过**：每项删掉后复杂度不搬家（barrel 转发不算复杂度），公开面收窄即 depth 提升。
- **公开 API 冻结测试挡「悄悄改」不挡「裁决后删」**（ADR-0003 的本意）；本 ADR 就是裁决记录。

## 影响

- 公开面（breaking）：删除 `SessionStartup` / `createSessionStartup` / `DEFAULT_CODE_CHECKPOINTS` / `MINIMAL_CHECKPOINTS` / `CleanStateManager` / `createCleanStateManager` / `AdaptiveTokenBudget` / `SessionCompaction` / `DEFAULT_COMPACTION_CONFIG` / `KnowledgeLifecycleHooks` 十个包根符号 + `PassesGate` 三方法 + 关联类型导出（`StartupCheckpoints` / `CleanStateConfig` / `CleanStateResult` / `DetectedBug` / `TaskListJson` / `TaskStepStatus` / `SessionInfo` / `CompactionResult` 等逐项核实随迁）。迁移路径 = 删引用（双仓已核实无引用）。
- 代码：core/session/ 整目录（startup + clean-state）、context/token-budget.ts 的 AdaptiveTokenBudget 段、context/compaction.ts、knowledge/lifecycle-hooks.ts 删除或收缩，以逐项删除测试结果为准。
- 测试：六个符号的自有测试文件随迁；AC-007 改写。
- 文档：core/CONTEXT.md、context/CONTEXT.md、knowledge/CONTEXT.md 的符号级提及同步；`docs/public-exports-review.md` 不回改。
