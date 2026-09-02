# ADR-0012: 测试输出解析收口——单一 test-output 模块

- 日期：2026-09-02
- 状态：已接受
- 影响版本：随下个 patch 发布（无对外破坏：新增包内模块，公开面与两门禁判定行为不变）
- 关联：架构评审 2026-09-02 候选 1（#80）；派生 #93（判定依据不一致）、#94（覆盖率归属裁决）

## 背景

架构评审（2026-09-02，候选 1，Strong）确认「读懂测试运行器打印了什么」这一概念有两处独立实现，且都被 private 关在类里：

- `src/core/validators/passes-gate.ts:380` `private extractCoverage`（认 jest `All files |`、istanbul `Statements :`、pytest `TOTAL`）与 `:405` `private extractFailures`（认 jest `✕ name (`、mocha `N) name:`、pytest `FAILED x::`、go `--- FAIL:`）
- `src/gates/acceptance.ts:486` `private parseTestOutput`（认 playwright `N failed`、jest `Test Suites: N failed`、通用 `PASS`/`FAIL`）

两处只有 jest 一个家族共同识别，用的信号还不同（`✕` 行 vs `Test Suites:` 汇总行），同一份 jest 输出可以一处看出失败、另一处看不出。

测试面证据（收口的直接动因）：

- `src/core/validators/__tests__/passes-gate.test.ts:116-130` 两个 describe 的注释自陈「extractCoverage is private … not easily testable without mocking exec」，体内只剩 `expect(gate).toBeInstanceOf(PassesGate)` 占位断言 —— 执法模块的解析分支覆盖率 0%。
- `src/gates/__tests__/acceptance.test.ts:380-506` 为触达一个 parser 分支写了 6 份近乎相同的 exec mock。

消费面核实（决定能否私有、破坏半径）：studio 是包唯一外部消费方，只穿过 `PassesGate.check()` → `{allowed, violations}`（`.scratch/harness-deep-clean/research-studio-usage.md` 护栏第 30 条；`packages/studio-shared/src/harness/hooks/completion.hooks.ts:7-19`，hooks 主链硬依赖）。`SpecAcceptanceGate` / `TaskTestResult` / `E2ETestResult` / `coverage` / `failures` studio 零引用；studio 自身不解析 runner 文本（`scripts/test-health-report.ts:148` 走 `vitest --reporter=json` 读结构化计数），故全仓不存在第三份实现。

## 决策

新增 `src/core/validators/test-output.ts`（包内模块，不进包根导出面，对齐 ADR-0009/ADR-0011 先例）：

- `extractCoverage(output)` / `extractFailures(output)` / `parseTestOutput(output)` 三个纯函数迁入并具名导出，**正则、分支顺序、返回形状逐字迁移**，不改任何判定语义。
- 消费方退化：`passes-gate.ts` 删两个 private 方法改 import（`:295 :312 :320`）；`acceptance.ts` 删 private `parseTestOutput` 改 import（`:461`）。exec 编排、retry、`detectTestCommand`、`generateEvidence` 留在各自 implementation 内部——它们是各自私有细节，不进 interface。
- **落点选 core 不选 gates**：合法依赖方向只有 gates→core。全仓 core→上层值导入现存 3 条（`capabilities-parser.ts:12`→cli、`:13`→gates，两条均 #88 待删；`checker.ts:20`→monitoring，core/CONTEXT.md 依赖关系已记为允许），其中指向 `gates/` 的只有 1 条——落 `gates/` 会把对 `gates/` 的上行边加成两条，与 #88 对冲。落 `utils/` 亦合法但不当：`utils/` 现职责是通用进程助手（`exec`/`file-walk`/`detect-source-roots`），runner 输出解读是验证领域知识，与 passes-gate 同族。
- 不加 `runner` 开关参数、不加注册表：两个真 adapter（passes-gate + acceptance）已在，seam 是显式化既有事实，不是新造。
- 保持不动（范围外，逐条已另票）：
  1. 两门禁判定依据不一致 —— passes-gate 成功分支硬编码 `passed = true`（`:294`，只看退出码），acceptance 只看文本且通用兜底可被测试名中的 `FAIL` 反转 → **#93**。
  2. `extractCoverage` 无判定消费方（`check()` `:89` 只读 `passed`/`evidence`），CLI `--coverage` 另走 json-summary 一条独立路 → **#94**。本 ADR 只搬不改，`TaskTestResult.coverage` 字段去留随 #94 裁决。
- 测试面：表驱动真实样本，每种 runner 一段真实输出文本（jest / mocha / pytest / go / istanbul / playwright + 无匹配 + 畸形各一行）直接测新模块 interface；删除 `passes-gate.test.ts:116-130` 两条占位断言；`acceptance.test.ts` 仅保留 `runE2ETest` 编排所需的 exec mock，6 份近重复中的解析用例全部搬入新表。

## 理由

- 测试面：执法模块的解析器第一次可从 interface 测（`no_test_simplification` 铁律的正解——不是降标准，是把判定挪到可测的位置，与 ADR-0009 的 `evaluate(env)` 旁测同一手法）。
- locality：加一个 runner 家族 = 加一行样本数据；jest 双信号漂移从「靠注释同步」变成结构上不可能。
- leverage：一套正则两处消费，acceptance 白得 mocha/pytest/go 识别能力（行为不变，因其 `parseTestOutput` 路径未接）。
- deletion test 通过：删掉共享模块，正则不会消失，只会以两份回归——正是现状。

## 影响

- 预期零行为变更：三个函数逐字迁移，两门禁判定与 CLI 输出不变。验收硬门槛：`passes-gate` / `acceptance` 既有用例（除两条占位断言）**不改一条断言**全过。
- 新增 `src/core/validators/test-output.ts` 与 `__tests__/test-output.test.ts`；`src/core/CONTEXT.md` 增记「测试产物解读唯一实现」；`src/gates/CONTEXT.md` 的 SpecAcceptanceGate 行补注解析器已外移。
- 覆盖率变化：解析器分支覆盖 0% → 表驱动全覆盖；`harness check` 与 studio hooks 主链行为逐字不变。
- 本 ADR 不解决 #93/#94 的分歧，只是把「同一知识两份实现」的漂移面从 2 缩到 1，使后续统一只需改一处。
