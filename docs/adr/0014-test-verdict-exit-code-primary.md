# ADR-0014: 测试门禁判定依据统一——退出码为主 + 文本交叉否决

- 日期：2026-09-03
- 状态：已接受
- 影响版本：下个 minor（1.4.0）—— `PassesGate` 判负条件变化，`check()` 的 `allowed` 得出条件随之改变；studio 消费的 `{allowed, violations}` 形状不变
- 关联：#93（本票，从 ADR-0012 的「保持原样」清单里出来的一条）；前置 ADR-0012（解析器收口）；#94（覆盖率取数归属）/#95（projectPath 语义）不在本票范围

## 背景

ADR-0012 把三个解析器收进 `src/core/validators/test-output.ts`，但只搬不改，判定依据的分歧留在原处（#80 收口时查实）：

- `passes-gate.ts` 的 `runTest` 成功分支把 `passed` 硬编码为 `true` —— 命令退出码为 0 就算过，打印出来的文本一律不看（`extractFailures` 在成功分支根本不参与）。文本只在失败分支出现，且用法是 `allowPartialPass && failures.length === 0` —— 即**文本可以把非零退出救成 pass**。
- `acceptance.ts` 的 e2e 分支反过来：完全按 stdout 文本判，最后一档通用兜底是 `output.includes('PASS') && !output.includes('FAIL')`。大小写敏感的子串匹配意味着通过的用例名里带大写 `FAIL`（`✓ FAIL 时应该重试`）、路径里带 `FAIL/` 目录名，都能把结论反转成判负；而 jest 零失败的汇总形状 `Test Suites: 0 failed, 2 total`（没有 "passed" 字样）也被判负。
- 两个门禁认 jest 的信号还不同：`✕ name (` vs `Test Suites: N failed`。同一份 jest 输出可以一处看出失败、另一处看不出——而这两个门禁会在同一个 task 上先后执法。

后果不是「不够严」，是**结论可被测测方的措辞反转**：写一个测试名字就能改变门禁的回答。

## 决策

判定依据只留一条，收在 `test-output.ts` 新增的 `judgeTestRun({ exitCode, output, allowPartialPass })`；两个门禁都只从它取结论，各自体内不再有第二处判定 `if`：

1. **退出码为主**：`exitCode !== 0` → 判负。输出里的任何内容都不能把它救成 pass。
2. **文本交叉否决**：`exitCode === 0` 时，文本中的失败信号否决它 → 判负。信号只有两类，且全部行首锚定：
   - `extractFailures` 认出的用例级失败（jest `✕`、mocha `N) name:`、pytest `FAILED x::`、go `--- FAIL:`）；
   - 结构化汇总/套件行：`FAIL <path>`、`Test Suites|Suites|Tests: N failed`（N>0）、`N failed|failing`（N>0）。计数为 0 的汇总行是全过，不构成信号。
3. **删除 `parseTestOutput`**：「纯文本判定」这一档不再存在，裸 `includes('PASS') && !includes('FAIL')` 兜底一并弃用——子串可被测试名/路径反转，jest 双信号漂移也源于它。
4. 两门禁喂进去的文本统一为 **stdout + stderr 合并**（acceptance 原本就合并，passes-gate 成功分支原本只看 stdout）。不一致时以合并为准，否则「同一份输出」在两门禁不是同一份。
5. `allowPartialPass`（CLI `--allow-partial`）的落点从「非零退出的赦免」移到「文本否决这一维的开关」：退出码 0 + 文本有失败信号 → 开了就算过；非零退出码一律不赦免。名字的含义（部分测试没过但命令本身过了）没变，变的是它作用的那一维。
6. 文本不否决「没跑出测试」：exit 0 + 空输出 / `0 passed` → 判过。零测试识别是另一件事（各 runner 对 no-tests 的退出码策略本就不同：jest 需 `--passWithNoTests`、pytest 有 `--no-tests-are-ok`），不塞进本判定，另票议。

不改的：exec 编排、retry、`detectTestCommand`、`generateEvidence` 留在各自 implementation 内部；`TaskTestResult` / `E2ETestResult` / `PassesGateCheckResult` 三个形状不动；`extractCoverage` / `extractFailures` 的正则与返回形状逐字不动（覆盖率归属是 #94）。

## 理由

- 判定是一条知识，两个门禁执法——知识收在数据出入口（纯函数、字符串进出、不做 IO）上，执法点退化为一行调用。与 ADR-0009 / ADR-0012 / ADR-0013 同一手法。
- **为什么退出码为主**：退出码是 runner 对自己结果的自我编码，文本是给人看的副产物。只信文本会一直被 reporter 形状追着改（`✕` vs `✘`、`Test Suites` vs `Suites`、verbose vs 非 verbose）；只信退出码则挡不住 `cmd || true`、`set +e`、wrapper 吞码这类退出码撒谎。交叉否决各取两者能防的一半。
- **否决方向为什么单向**（文本可否决零退出，不能救非零退出）：前者漏放的代价是错放一个 task，后者的代价是把真失败标成通过——而后者正是 Iron Law #2（NO SELF APPROVAL WITHOUT TEST EVIDENCE）与 #3 要守的那条通道。单向不是保守，是两向代价不对称。
- 一致性从「靠测试保证」变成「结构保证」：两门禁消费同一个纯函数、喂同一种文本，「两门禁结论相反」需要有人重新在门禁体内写判定 `if` 才可能出现。一致性用例只是这个命题的哨兵（票面后果 3）。

## 影响

- 行为变更（minor 级）：
  - exit 0 + 输出含失败信号 → 判过转判负（收紧）。直接受影响的公开面：`harness passes-gate`、`setPasses()`、`runTests()` → `check()` 的 `allowed`。
  - exit != 0 + `--allow-partial` + 文本无失败名 → 判过转判负（收紧：退出码不再被文本赦免）。
  - 全绿但用例名/路径含大写 `FAIL`，或 jest 零失败汇总无 "passed" 字样 → 判负转判过（放松：误伤修复）。
  - `TaskTestResult.output` 与 evidence 文件从成功分支起含 stderr（原为 stdout 单独一份）——与判定所用文本同源，证据即判据。
  - studio：只穿过 `check()` 且自己跑命令传 `passed`（ADR-0012 消费面核实），入参出参形状不变，故 studio 主链本次无实测行为变化；受判定收紧影响的只有直接调 `runTests()` / `setPasses()` 的消费方。
- 测试面：`core/validators/__tests__/test-output.test.ts` 的 `parseTestOutput` 表整块换成 `judgeTestRun` 表（退出码升为一维，旧 ⚠ 行的期望值按本裁决翻转，新增 allowPartialPass 与零退出/零测试边界行）；新增 `gates/__tests__/test-verdict-consistency.test.ts`，从两门禁公开面喂同一份样本，先钉票面 3 个后果（红：两门禁给出 3 组相反结论）再修绿。落点选 `gates/`：`src/core/**` 禁值导入 `gates/`（#88 的 eslint error 规则 + `layering.test.ts`）。
- 文档：`src/core/CONTEXT.md` 与 `src/gates/CONTEXT.md` 的 test-output 行改记「判定唯一入口 judgeTestRun」；`PassesGateConfig.allowPartialPass` 的 JSDoc 改记新落点；CHANGELOG Unreleased 记 minor。
- 本 ADR 不解决：一次跑完收集所有失败（retry 编排首个失败即定，另票）、#94 覆盖率取数归属、#95 projectPath 语义、零测试识别（决策 6 明确排除）。
