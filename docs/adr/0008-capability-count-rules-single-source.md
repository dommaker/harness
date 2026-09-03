# ADR-0008: capabilities 统计规则收敛为单份定义

- 日期：2026-08-19
- 状态：已接受
- 影响版本：1.2.0

## 背景

架构评审（2026-08-19，候选9）确认 `src/core/constraints/capabilities-parser.ts` 的 4 项能力清单统计（CLI Commands / Quality Gates / Iron Laws / Guidelines）的 label+pattern 在两个方向各写一遍：`buildCapabilityChecks()`（check 方向，FreshnessRunner doc_regex_count 配置）与 `updateCapabilityCounts()`（write 方向，regex 替换文本）。新增/调整一项统计必须记得改两处，漏一处即 check 与 write 口径分叉（check 放过漂移或 write 改不动对应行）。

（评审报告原提的「硬编码目录结构计数」问题已随 ADR-0003 连带修复消失——计数早已取 COMMAND_DEFINITIONS/GATE_DEFINITIONS/IRON_LAWS/GUIDELINES 定义表，本 ADR 只收敛剩余的 label+pattern 双写。）

## 决策

抽模块级单例 `CAPABILITY_COUNT_RULES`（4 条，字段：`label` / `pattern` / `actual: () => number`）：

- `pattern` 为字符串，同时供 check（doc_regex_count 的字符串 pattern，捕获组为文档计数）与 write（`new RegExp(pattern)` 编译为替换 regex）——两个方向连正则文本都共用，不单列 writePattern 字段。
- `label` 同时作 check 的 DocFreshnessCheck.label 与 write 的替换文本前缀（`Label (N)`，write 方向的单数化归一语义保持原样）。
- `buildCapabilityChecks()` 与 `updateCapabilityCounts()` 各自从规则表 map 投影生成；两方向对外函数签名与行为逐字不变。

> **2026-09-03 harness#88 补注**：为收掉 core→cli/gates 的上行值导入，规则表从模块级单例 `CAPABILITY_COUNT_RULES` 改为 `capabilityCountRules(source)`——「单份定义」性质不变（两方向仍投影自同一处），只是 CLI Commands / Quality Gates 两项的 `actual` 取自调用方注入的 `CapabilityDefinitionSource`（cli 侧组装 COMMAND_DEFINITIONS/GATE_DEFINITIONS），Iron Laws / Guidelines 两项仍取 core 自身定义表。两方向对外签名各多一个 `source` 形参（`updateCapabilityCounts` 顺势去掉从未使用的 `projectPath`），文档写回结果不变。

## 理由

- 双写通过 deletion test：收敛后规则只有一份，check/write 分叉这一类 bug 从结构上不可能再发生，而非靠纪律维持同步。
- 行为不变性已验证：CAPABILITIES.md 写回幂等零变化、人为漂移（`CLI Commands (999)` / 单数 `Iron Law (0)`）被修正为定义表计数、`checkCapabilityCounts` match=true，全量测试 120 套件绿。

## 明确不做

- 不把规则表提成对外导出：消费方只有本模块两个函数，导出是假想需求（YAGNI）。
- 不动 `isCapabilityListingFormat` 的格式探测正则（与计数替换是不同关注点，收敛它不减少任何同步点）。
- 非 breaking：对外签名与 CAPABILITIES.md 写回结果均不变；条目记 CHANGELOG 但不带 `!`。
