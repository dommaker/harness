# ADR-0018: performance 门禁维度删薄——只执法有真实现的维度，CLI 字段错位修复（架构评审候选2）

- 日期：2026-09-08
- 状态：已接受
- 影响版本：1.6.0（breaking 内容按 minor 号发布，2026-09-09 人类裁决推翻原「下个 major（2.0.0）」）—— 公开类型字段收缩 + 公共方法删除 + CLI 选项删除（breaking，与 ADR-0017 同车）
- 关联：架构评审 2026-09-08 候选2（grilling 决策树已走完）；ADR-0015（覆盖率删薄，同构判例）；ADR-0003（公共导出/类型面裁决后变更）

## 背景

`PerformanceGate` 的 interface 声称执法四个维度（响应时间/内存使用/覆盖率/打包大小），implementation 实况：

1. **responseTime/memoryUsage 用 `Math.random()` 伪造**。`collectMetrics` 对 `maxResponseTime`/`maxMemoryUsage` 阈值生成 `Math.floor(Math.random()*500)+100` 的伪数据，`check()` 拿它当真值判负——门禁报告里写着并不存在的「响应时间=XXXms」。interface 声称测量，implementation 掷骰子。
2. **真实现从未接线且语义可疑**。同文件存在 `runBenchmark`/`singleBenchmark`（warmup+measure 跑 `benchmarkCommand`，取 wall time 与 heap），但 `check()` 从不调用它；且其 `memoryUsage` 量的是 **harness 进程自己的 heap**，不是被测应用——接进 check() 等于把可疑语义升级为执法依据。
3. **两维零真实消费者**。studio 对 `PerformanceGate` 零引用；`registry.ts` 注册的是无阈值默认实例；`context.performanceThresholds` 全仓无人设置——随机分支只在测试里活。`PerformanceThresholds.minThroughput` 同型：没有任何 throughput 指标实现。
4. **CLI `harness performance` 字段全错位**。`config.thresholds.coverage`（真字段 `minCoverage`）、`bundleSize` 按字节乘 1024（gate 按 KB 比较）、context 传不存在的 `checkCoverage/checkBundle/checkBenchmark`、显示读不存在的 `metrics.benchmarkTime`——`--coverage`/`--bundle` 旗帜恒不生效，命令恒绿「无指标」。

## 决策

1. **responseTime / memoryUsage / throughput 三维连同 benchmark 机制整体删除**（ADR-0015 同构判例：不执法没有真实现支撑的维度）。删除面：`PerformanceThresholds.maxResponseTime` / `.maxMemoryUsage` / `.minThroughput`、`PerformanceGateConfig.benchmarkCommand` / `warmupRuns` / `measureRuns`、`GateContext.benchmarkCommand`、`runBenchmark` / `singleBenchmark`、`ExtendedPerformanceGateConfig.benchmarkTimeout`、`setTimeouts` 的 benchmark 项、CLI `--benchmark` / `--benchmark-timeout` 选项。门禁只剩 coverage（json-summary）与 bundleSize（dist 测量）两个真维度。
2. **不选「接进 runBenchmark」**：两维零真实消费者，测量语义可疑，接进是「修好一个没人用的测量」。
3. **CLI 字段错位顺手修**（同 seam 同文件族）：`--coverage-threshold` → `thresholds.minCoverage`、`--bundle-threshold` KB 直传 `thresholds.maxBundleSize`、幽灵 context 字段与 `benchmarkTime` 显示删除、打包大小显示的单位错误（`/1024`）修正。

## 理由

- **门禁 verdict 必须有因果**。拿随机数判负比不判更糟——它教会用户「这个门禁的结论不可信」，与候选1的假绿同族（interface 承诺与 implementation 实况背离）。
- **interface 收窄到真实消费者存在的面**。零消费者维度的字段、配置、方法、测试全是假想消费者的供养成本；删除测试通过——复杂度不搬家，直接消失。
- **测量语义不合格的「真实现」不算实现**。量自己进程 heap 的内存指标、等于命令 wall time 的「响应时间」，接进执法链只会把可疑数字写进门禁报告；要真做应用级基准测量，那是一个需要重新设计的特性（被测进程隔离、指标定义、环境稳定性），不是本次收口该顺手做的事。

## 影响

- 代码：`gates/performance.ts`（357→254 行，删随机分支/两维判定/runBenchmark/singleBenchmark/benchmark 配置）、`gates/types.ts`（六字段收缩）、`cli/commands/performance.ts`（字段对齐 + 幽灵面删除）、`gates/definitions.ts`（两个 CLI 选项删除）。
- 公开面（breaking）：`PerformanceThresholds` 收缩 3 字段、`PerformanceGateConfig` 收缩 3 字段、`GateContext` 收缩 1 字段、`PerformanceGate.runBenchmark` 方法删除、`setTimeouts` 选项收缩、CLI `harness performance` 删 `--benchmark` / `--benchmark-timeout`。studio 对全部删除面零引用。按 1.6.0 发布（与 ADR-0017 同车）。
- 行为：**`harness performance --coverage-threshold N` / `--bundle-threshold N` 从此真正生效**（此前恒不生效、命令恒绿）；设了 `maxResponseTime`/`maxMemoryUsage` 阈值的假设性消费方不再拿到伪造指标（该消费方全仓不存在）。
- 测试：CLI 侧两枚红灯先写后绿（构造参数钉 `minCoverage` / `maxBundleSize` KB 直传）；gate 侧删 runBenchmark 套件与随机维度用例，coverage/bundle 行为用例全保留。
- 文档：`gates/CONTEXT.md` 补「只执法有真实现的维度」约定、benchmark 引用清理；`CAPABILITIES.md` 只登记命令名，无变化。
