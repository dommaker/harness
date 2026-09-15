# ADR-0024: CommandGate 匹配谓词单点化 + 两个零消费者配置位删除（架构评审候选6）

- 日期：2026-09-15
- 状态：已接受
- 影响版本：随本车 ship 时裁决——公开类型字段收缩 + CLI 选项删除（breaking，判据同 ADR-0018/ADR-0022 的「breaking 内容按 minor 号发布」先例；唯一消费者 studio 对删除面零引用）
- 关联：harness#135；架构评审 2026-09-14 候选6；ADR-0018（只执法有真实现的维度）；ADR-0022（零消费者公共面收缩）；ADR-0003（公共导出/类型面裁决后变更）；ADR-0007（门禁 CLI 元数据形状）

## 背景

`CommandGate` 用一份规则表服务三个入口（`check()` 经 `checkBlacklist()`、`isAllowed()`、`getRiskLevel()`），但三条循环各写了一遍同一套语义：忽略类别 → 模式测试 → 按级别分派。三条逐行同构，改一条匹配语义要动三处。

核查（2026-09-15 重核）另确认三处「声明与执法背离」：

1. **`CommandGateConfig.strict` 配了不生效**。类型注释承诺「warn 也阻止」，CLI 侧 `--strict` 旗帜把它写进构造参数，但三条判定循环从不读取该字段（全仓唯一读取点在构造器）。带不带旗帜的判定完全一致。
2. **`CommandGateConfig.customBlacklist` 零生产注入者**。除自身构造器与类型声明外，两仓无任何注入方——`addRule()` 才是已存在的运行时扩展点。它是给下游的假扩展点。
3. **`--level` 分支的配置到不了判定**。CLI 默认分支用带配置创建的实例，`--level` 分支却调模块级单例出口，两条入口两套实例来源。

三条循环且级别解释各写一遍的后果还包括：三投影可以互相矛盾而无测试报警——`getRiskLevel()` 取规则表里**首条**命中的级别，若首条是较低级别而集合里另有阻断级命中，它报出的等级与同一条目在 `check()` / `isAllowed()` 上的裁决相反。

## 决策

1. **匹配收成一个谓词**：`matchCommand(command) → 命中规则集合`（模块私有）。规则表的遍历、类别忽略、模式测试只在这一个函数体内发生。
2. **级别语义收在一个归一点**：`judge(command)` 把命中集合折成一份裁决（阻断/警告/审计三桶 + `allowed` + `riskLevel`），`check()` / `isAllowed()` / `getRiskLevel()` 退化为该裁决之上的三个投影。谓词与归一点都是私有的，公共面形状不变（`CommandGate` 的成员面不增）。
3. **等级取命中集合里的最高档，与规则表次序无关**（决策 2 的直接结果，是行为修正而非行为保持）：不变式钉为「存在阻断级命中 ⟺ `check` 不通过 ⟺ `isAllowed()` 为 false ⟺ 等级 high」，由测试对同一输入三投影对撞断言。
4. **`strict` 删，不接进判定**（判据：零消费者、从未生效、下游零引用；ADR-0018 同判据）。CLI `--strict` 旗帜一并 removal（对外 CLI 面变化，按 ADR-0018 先例走 minor 号发布）。「接进判定」被否决：那等于为一个零消费者开关新增「warn 级命中从此阻断」的执法语义，并要下游同步重审自己的 hook 配置——是为假想消费者补面，不是收口。
5. **`customBlacklist` 删**：零生产注入者，运行时扩展点是 `addRule()`；配置位与运行时入口二选一，留后者。
6. **hook 侧保持裸构造，不引入项目配置装载**：「hook 只用出厂规则」是决定而非疏漏，正本写进 `src/gates/CONTEXT.md`（连同 fail-open 与「warn/audit 级放行」口径）。CLI 与 hook 是同一决策模块的两个 adapter，配置装载只发生在 CLI 一侧。
7. **`--level` 与默认分支共用同一台实例**：模块级单例出口不再出现在命令实现里。

## 理由

- **配了不生效的开关比没有开关更糟**：用户会以为它生效。这与 ADR-0018 处理的「interface 声称执法、implementation 从不执法」同族，处置也相同——按 ADR-0022 的判据删，而不是顺手接。
- **三份同构循环是同一语义的三个户口**：唯一化之后「改一条匹配语义要动三处」不复存在，且投影间矛盾从「需要测试才不出现」变成「构造上不出现」。
- **删除测试通过**：两个配置位删掉后复杂度不搬家——规则表、`addRule()`、三投影的既有职责一概不变，公开面只会更窄。

## 影响

- 代码：`gates/command.ts`（三条循环 → 一谓词一归一，440 → 426 行）、`gates/types.ts`（`CommandGateConfig` 收缩两字段）、`gates/definitions.ts`（command 门禁删一旗帜）、`cli/commands/command.ts`（`CommandCheckOptions.strict` 与单例出口引用删除，`--level` 改读实例）。
- 公开面（breaking）：`CommandGateConfig` 两字段（类型面）、CLI `harness command --strict`（选项面）。`CommandGate` 与 `isCommandAllowed` / `getCommandRiskLevel` / `getCommandGate` 的签名不变。
- 行为：多重命中输入上 `getRiskLevel()` 的返回可能由较低档变高（决策 3）；`harness command --level` 因此可能与旧的等级报告不同，但与同一条目的裁决一致。
- 测试：新增 `src/gates/__tests__/command-single-predicate.test.ts`（源形状闸：模式测试 / 类别忽略 / 规则表遍历各恰好一处，级别分派不再有 `switch`；一致性闸：三投影对同一输入自洽，含次序无关的正对照与忽略类别对三投影同样生效，输入用 `addRule()` 挂的合成规则）与 `src/cli/commands/__tests__/command-gate-dead-options.test.ts`（定义表旗帜面逐字冻结 + `@ts-expect-error` 编译期钉两个已删字段与 CLI 同名字段 + 配置读取面运行期形状钉）；既有 `customBlacklist` 用例改走 `addRule()`；CLI `--level` 用例的替身补 `getRiskLevel`，并新增「等级取自本命令创建的那台实例、全程只创建一次」一条。
- 措辞纪律（PIT-021）：本 ADR 与对应 commit message / CHANGELOG / CONTEXT 只写泛化表述，不复述规则表内容，不写具体规则的匹配样例与生效范围结论。
- 记名不动：三个模块级便捷出口（`getCommandGate` / `isCommandAllowed` / `getCommandRiskLevel`）在决策 7 之后于本仓生产路径零消费者（`isAllowed` 的 hook 侧消费是实例调用，不经单例）。它们是包根与 `./gates` 的冻结公开面（ADR-0003/0022 口径），删除属另一张公共面收缩票，本票不顺手做。
