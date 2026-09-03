# ADR-0015: 覆盖率归属——harness 核心判定不取数、不执法（#94 裁决 B 删薄）

- 日期：2026-09-03
- 状态：已接受
- 影响版本：下个 minor（1.4.0）—— 公开类型 `TaskTestResult` 删除 `coverage` 字段（类型面收缩，读侧得 undefined）
- 关联：#94（本票）；前置 ADR-0012（解析器收口，把字段去留挂给本票）、ADR-0014（判定依据统一，明确写了覆盖率归属不在其内）；同类公开面收缩裁决 #92；邻接 #84（配置读取收口）

## 背景

「覆盖率是多少、够不够」在本仓有两个答案来源，而其中一个的输出没有任何判定消费方（#80 收口时查实，ADR-0012 记为挂账 2）：

1. **regex 路**：`extractCoverage`（现住 `src/core/validators/test-output.ts`）从 runner 的 stdout 文本认 jest `All files | 80.50`、istanbul `Statements : 80.5%`、pytest-cov `TOTAL 1234 80%`，结果只写进 `TaskTestResult.coverage`。而 `PassesGate.check()` 只读 `passed` 与 `evidence`，`runTests()` 的返回形状里根本没有这个字段，studio 也不读（ADR-0012 消费面核实：`coverage` / `failures` 零引用）。即：这条正则的唯一用途是填一个无人读取的展示字段。
2. **json-summary 路**：`harness passes-gate --coverage`（`src/cli/commands/passes-gate.ts` 的 `coverageCheck`）自己跑 `npm test -- --coverage --coverageReporters=json-summary`，再读 `coverage/coverage-summary.json` 的 `total.lines.pct` 与阈值比较；`performance` 门禁（`src/gates/performance.ts` 的 `collectCoverage`）是第三家，同样读 json-summary、同样有阈值判定。三者一行代码都不共享。

triage 修正了票体的初判：仓内「判覆盖率」的其实有三家（regex 路 + CLI `--coverage` + performance 门禁），但只有后两家有真判定，且都不消费 regex 路的数据。所以问题不是「一个判了没人当真」，而是**regex 路既不被判定消费、又是一份脆弱的解析**（ADR-0012 的表驱动用例实测钉住：pytest-cov 默认四列表读不出来，返回 undefined）。

## 决策

**B 删薄 —— harness 核心判定不管覆盖率执法。**

1. 删除 `extractCoverage`：`src/core/validators/test-output.ts` 的运行时导出面从 3 个缩到 2 个（`extractFailures` / `judgeTestRun`）。
2. 删除公开类型 `TaskTestResult.coverage`（`src/types/passes-gate.ts`），`PassesGate.runTest` 不再填它。连带删除 `src/types/session.ts` 里模块内镜像类型 `TaskTestResult` 的同名字段——它是 harness 产出形状的副本，产出侧已不写；字段本就可选且全仓零读取，历史 session JSON 不受影响。
3. **保留** `harness passes-gate --coverage` 子路径（`coverageCheck`）：它有真 CLI 消费面，取数（json-summary）、阈值（默认 80）、退出语义（未达标 → `skip`，不改退出码）**逐字不变**。
4. **保留** `performance` 门禁的 `collectCoverage` + 阈值判定：那是它的本职（质量门禁），不在收缩范围。
5. **保留** `TestResult.coverage`（`check()` 的入参类型）：业务层自己跑测试得到的数据，harness 只随 `testResult` 原样回显，不取数也不据它判定。与第 2 条不矛盾——删的是「harness 自己产出的字段」，留的是「调用方传进来的字段」。
6. 职责边界定名：要「覆盖率不达阈值就拦」，用 `performance` 门禁或 CI（`.github/workflows/coverage-gate.yml`），不是 `passes-gate`，也不是 `PassesGate.check()`。

不选 A（收编为正式判定项、两条路合一）：合一要以 json-summary 为正本，等于把 `runTest` 从「跑一条命令读文本」改成「执法路上再跑一次带 `--coverage` 的命令读文件」——一次执法两回开销，还硬要求项目具备 json-summary Reporter；而 A 另需先定阈值来源（config.yml `quality.coverage_threshold` vs 仅 CLI flag），那是 #84 配置收口之后的事，不该由一条零消费的通路来预先决定形状。
不选 C（维持，只把分叉存档为债务）：ADR-0012 已经把它记成挂账，债务的实际成本是每次读 `test-output.ts` 都要重新解释一遍「这里读覆盖率却没人用」；删掉之后这个问题不再存在，答案从注释搬进了类型面。

## 理由

- deletion test 通过且是反向的：删掉这条通路，没有任何判定发生变化——因为它本来就不参与判定。一个只填零读取字段的解析器不是功能，是维护面。
- 脆弱性方向不对：正则读文本表要追着 reporter 形状改（jest verbose 与否、`All files` 的列宽、pytest-cov 的列数），而同一件事在 json-summary 路上是读一个有 schema 的 JSON。已有两处走稳路，没理由让第三条判定通路走脆路。
- 职责单一：`passes-gate` 执法的是 Iron Law #2/#3（「有没有测试证据」「有没有fresh验证」），是「过了没」；覆盖率是「够不够多」，另一维指标，已有专雇（performance 门禁）与 CI 管。CLAUDE.md 设计原则「No business logic — only provides capabilities」在此的同源读法：harness 不替项目决定它的覆盖率目标。
- 收缩公开类型是可付的代价：`TaskTestResult` 经 `src/index.ts` 包根导出，删字段属破坏性收缩，但唯一外部消费方 studio 对它零引用（ADR-0012 核实），故按 minor 记录、不留兼容 shim（与 #92 的 barrel 收回同类）。

## 影响

- 代码：`test-output.ts` 少一个导出；`passes-gate.ts` 的 `runTest` 少一处赋值，其 `stdout` 中间变量随取数点消失（`output` 的组合方式与 evidence 内容逐字不变）；`src/types/session.ts` 镜像类型少一个可选字段。
- CLI 与门禁：`harness passes-gate --coverage` / `--coverage-threshold` 行为不变；`performance` 门禁不变；CI 的 coverage-gate.yml 不变（本就不在本票范围）。
- 公开面：`TaskTestResult` / `ExtensionTestResult`（继承它）不再有 `coverage`；`PassesGateExtension.run()` 的实现方（如 E2E 扩展）返回该字段会变成多余属性——TS 的对象字面量多余属性检查会报错，属预期的公开面收缩，CHANGELOG 记 minor。包根运行时导出清单不变（`extractCoverage` 本就是包内符号，`public-exports.test.ts` 无需改动）。
- 测试：`core/validators/__tests__/test-output.test.ts` 的 `extractCoverage` 8 条表驱动用例整块换成一条导出面守卫（`Object.keys` 钉住只剩 `extractFailures` / `judgeTestRun`），三份只被它消费的覆盖率样本随之删除；`__tests__/passes-gate.test.ts` 新增两条——真实 exec 喂 jest 覆盖率表样本后断言 `setPasses` 结果不带 `coverage`，以及 `@ts-expect-error` 在编译期钉住类型面不接受该字段。红-绿记录：删除前该 exec 用例实测拿到 `coverage=80.5`。
- 文档：`src/core/CONTEXT.md` 的 validators 行改记「不读覆盖率」（ADR-0012 挂账 2、ADR-0014「不改的」中指向 #94 的两处随之闭合，历史 ADR 正文不改）。
- 本 ADR 不解决：`coverageCheck` 与 `performance.collectCoverage` 两处 json-summary 读取的收敛（票面 Out of scope，另票）、零测试识别（ADR-0014 决策 6）、`--coverage` 路由的 projectPath 语义（#95）、CI 侧覆盖率门禁。
