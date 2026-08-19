# ADR-0003: 包公共导出收敛为显式清单

- 日期：2026-08-19
- 状态：已接受
- 影响版本：1.2.0

## 背景

1. **`export *` 无界面**：包根 16 个 `export *` 级联展开后公共面达 377 个符号（含纯类型），增删符号无任何评审触点，「公共 API 是什么」只能跑编译器才能回答。
2. **同名遮蔽咬人两次**：`checkConstraints` 在 `core/constraints/checker.ts`（位置参数版）与包根便捷封装（options 版）同名并存，`export *` 下后者静默遮蔽前者，消费方拿到的签名取决于导入路径；types barrel 注释中另记录着一次星-星歧义静默丢符号的前科。
3. **377 vs 实际消费**：studio 实际消费 58 个符号，公共面里混着整编制的断链子系统（safety/verification/dashboard 等）与内部 seam（`constraintChecker` 单例、`ProjectConfigLoader`），符号存在 ≠ 可用。

## 决策

### 1. 包根改显式清单

`src/index.ts` 废弃全部 `export *`，改为按子系统分组的显式命名导出（带分组注释头）。收录标准三问：

1. 属 harness 定位（约束数据 / 执行引擎 / 注入工具 / 知识基建）？
2. 实现真实可用（非断链/重复实现）？
3. 无同名冲突？

studio 实际消费的 58 个符号全数收录；逐符号判定见 `docs/public-exports-review.md`（377 原符号去留 + 理由）。

### 2. 删除断链/重复子系统

删除判据是**第一性分析（重复已接线实现 / 生产断链 / 与「文件驱动 CLI」定位冲突），而非消费面**——消费面小是结果不是原因：

- `src/safety/`：护栏三件套（input/output/tool guardrail + sandbox）与已接线的 CommandGate + pretool-use-hook 纵深防御重复，无生产接线。
- `src/verification/`：验证循环（rules-based/loop）无生产消费者，验证故事已由检查点 + 门禁承载。
- `src/dashboard/`：数据聚合层无消费者，CLI status 直读 TraceAnalyzer。
- `src/spec/annotation-checker.ts`：标注检查与已接线的 spec 故事（`core/spec/validator` + SpecAcceptanceGate）重复。
- `src/monitoring/` 六文件（constraint-doctor / diagnosis-rules / knowledge-doctor / knowledge-evolver / performance-collector / performance-analyzer）：诊断规则仅服务已删的 ConstraintDoctor；性能链路与知识医生链路生产断链，知识健康分已由 `knowledge/doctor.ts` 的 KnowledgeHealthScorer 承载。保留 traces / trace-analyzer / analyzer-base / context-tracker（均在接线）。
- `src/types/performance.ts`、`src/types/monitoring-types.ts`：仅服务上述已删链路的孤儿类型，删除前核验零引用。
- recordBypass 链整条：`TraceCollector.recordBypass`、`ExecutionTrace.result`/`TraceFilter.result` 的 `'bypassed'`、`TraceSummary.bypassCount/bypassRate`、bypass 两类异常（high_bypass_rate / rising_bypass_rate）、usage-report 的 bypassed 统计、check 命令的 high_bypass 提示分支。「绕过」语义自始无写入方之外的观测闭环。
- 消费方收口（2026-08-19 补注）：studio 对 safety 三符号（`InputGuardrail`/`OutputGuardrail`/`Sandbox`）的仅存引用——guards REST 路由（/check-input、/check-output、/sandbox）与 checkGuardrail/getSandboxLevel 两个 MCP tool——已在 studio 仓删除（studio@8afdccde），1.2.0 升级无断裂面。
- 连带修复：`capabilities-parser` 的 CLI Commands / Quality Gates 计数口径从目录文件数（dir_count，递归误数子目录文件，产出与名单矛盾的 26/12）改为定义表计数（`COMMAND_DEFINITIONS.length` + 带 cli 的 `GATE_DEFINITIONS` / `GATE_DEFINITIONS.length`，ADR-0002 单一来源），check 与 update 两个投影共用同一来源。

### 3. 子路径出口保留并显式化

`package.json` exports 维持 5 个出口（`.` `./core` `./presets` `./context` `./gates`），`files` 不动——`dist/pretool-use-hook.js` 继续随包出厂（studio 以文件路径硬依赖）。各子路径 index 同步改显式清单；`./core` 保留内部 seam（ConstraintChecker/constraintChecker/ProjectConfigLoader/interceptor 族）作为逃生舱，包根不收录。

### 4. 同名 checkConstraints 统一为 options 版

`core/constraints/checker.ts` 的 `checkConstraints` 快捷函数签名统一为 `(context, options?: CheckConstraintsOptions)`（`options.customConfig` 承载 per-request 配置、`options.onTrace` 承载逐条回调），包根与 `./core` 导出同一实现；位置参数版删除。`checkConstraint` / `checkBeforeExecution` 的 per-request customConfig 参数保持不动（O4 工单语义不丢）。

### 5. 副作用幂等收敛

`constraintChecker.setTraceRecorder(getTraceCollector())` 原散落在包根 import 副作用、bootstrap（×2）、CLI check/report 共 5 处。收敛为 ConstraintChecker 内部幂等单点：首次记录 trace 时惰性接线 `getTraceCollector()`（未显式注入时），全部外部调用点删除；`setTraceRecorder` 保留为测试/定制注入口。CLI check 与 bootstrap 路径 trace 记录行为不变。

### 6. 快照测试防回归

新增 `src/__tests__/public-exports.test.ts`：显式数组比对包根运行时导出键集合，增删公共符号必须同步改清单（diff 即评审材料）。纯类型导出由 `src/index.ts` 显式清单编译期把关。

## 后续立项

1. **绕过观测**：recordBypass 链拆除后，「用户绕过约束」的观测能力整体缺失；如需恢复，按「先定义写入语义与消费闭环」重新立项，不恢复旧链。
2. **annotation-checker 迁移为 ConstraintCheck**：标注检查若仍有价值，应改写为 ConstraintCheck 注册进闭环注册表（ADR-0001/0002 范式），而非独立子系统。

## 明确不做

- **interceptor 本次不删**：`ConstraintInterceptor`/`interceptOperation`/`claimOperation`/`registerExecutor` 及 enforcement 类型仅从包根公共面摘出，实现保留（`./core` 可达）；退役单独立项。→ 已由 ADR-0004 兑现：整体物理删除，见 `docs/adr/0004-retire-constraint-interceptor.md`。
- package.json 版本号与 CHANGELOG 不动（发布走 harness-ship）。
