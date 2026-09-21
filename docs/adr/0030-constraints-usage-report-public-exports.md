# ADR-0030: constraints usage-report 数据层包根导出记名（E1 复盘修正 M3.4）

- 日期：2026-09-21
- 状态：已接受
- 影响版本：无新变更（导出已随 5d0d84a 落地，本 ADR 是记名追认 + 冻结清单收口）
- 关联：studio#602（E1 约束进化提案链路，消费者出处）；studio `docs/plans/2026-09-flywheel-e1-remediation.md` M3.4（裁定来源）；2026-09-21 会话当场人闸裁定「保留导出 + 补冻结清单 + ADR 记名」；ADR-0003（公共导出显式名单）；ADR-0022（零消费者公共面收缩判据——本 ADR 是其「记名保留」出口的正例）

## 背景

5d0d84a 把 `src/core/constraints/usage-report.ts` 的数据层 API 加入包根公共导出（7 值 5 型），但 `public-exports.test.ts` 与 `public-type-surface.test.ts` 两道冻结清单未同步，master 测试红。E1 复盘修正计划 M3.4 要求裁定：CLI 通则删导出，确需导出则补 ADR 记名。

事实核查（2026-09-21，双仓）：

- **活消费者**：studio `apps/api/src/modules/evolution/generator.ts` named import `buildConstraintsUsageReport` / `CANDIDATE_KIND_LABEL` / `ConstraintsUsageReport`（类型），驱动 E1 (a) 链路的退役候选提案生成。
- **为什么不走 CLI**：generator 在 studio API 进程内每轮进化扫描高频取数，需要结构化类型（`ConstraintsUsageReport`）而非 spawn 子进程再解析 stdout；spawn 的进程开销与失败语义都不适合进程内循环。CLI 路径 `harness constraints report --json-output` 已随 M3.1 修复可用，保留为**外部/脚本消费**的备选通道。
- **消费者不对称**：12 个符号中直接消费者覆盖 3 个（上条）；其余 9 个（`diagnoseRetireCandidates` / `collectUsageByConstraint` / `readProjectTraces` / `readProjectTracesReport` / `DEFAULT_DIAGNOSE_THRESHOLDS` + 类型 `ConstraintUsageStats` / `RetireCandidate` / `RetireCandidateKind` / `DiagnoseThresholds`）是同一模块的连贯支撑面（候选诊断、阈值、trace 读取与结果类型），消费方做过滤/类型标注时的自然触点。全组保留是 2026-09-21 人闸裁定；若日后清账时仍只有 3 个符号有消费者，可按 ADR-0022 判据重新裁定收窄。

## 决策

1. **保留全部 12 个导出**（清单见下），不删不裁。
2. **冻结清单同步**：`public-exports.test.ts` 补 7 个值符号，`public-type-surface.test.ts` 入口 `.` 补 5 个类型——本 ADR 即该 diff 的评审材料（ADR-0003 口径）。
3. **CLI 与库双通道并存**：库导出供进程内消费者（studio evolution），CLI `--json-output` 供外部脚本；新增消费者优先复用既有通道，不另开面。

## 导出清单（包根 `src/index.ts`，来源 `core/constraints/usage-report.ts`）

- 值（7）：`buildConstraintsUsageReport` / `diagnoseRetireCandidates` / `collectUsageByConstraint` / `readProjectTraces` / `readProjectTracesReport` / `CANDIDATE_KIND_LABEL` / `DEFAULT_DIAGNOSE_THRESHOLDS`
- 类型（5）：`ConstraintUsageStats` / `RetireCandidate` / `RetireCandidateKind` / `DiagnoseThresholds` / `ConstraintsUsageReport`

## 影响

- 公开面：无新增（追认 5d0d84a 既有面）；冻结清单与实现恢复一致，master 测试转绿。
- 反悔成本：收窄 = 删符号 + 双仓核消费者，按 ADR-0022 既有流程走。
