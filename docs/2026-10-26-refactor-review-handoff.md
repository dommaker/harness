# Harness 架构、性能与安全重构交接

> 日期：2026-10-26
> 仓库：`@dommaker/harness`（本机 checkout）
> 审查基线：`master@b82bf16e7449f4fd19ef873fefab4b3ee311bc88`（`@dommaker/harness` 4.0.1）
> 状态：只读审查完成。切片 P0.1–P0.4 已实现并通过相关测试与构建，均已提交。P0.5（入库命令信任模型）已完成产品裁决，记录见 P0.5 小节"已裁决"块——**仅为文档裁决，未改任何代码或默认行为**。切片 P1.1（唯一装配入口与生命周期）已实现并通过相关测试与构建，已提交（d37b830）。切片 P1.2（运行级 ProjectSnapshot 收口文件读取）已实现并通过相关测试与构建，已提交（976228d）。切片 P1.3（知识查询引用记账批量化）已实现并通过相关测试与构建，已提交（7f697f7）。切片 P1.4（收窄 GateContext）已实现并通过相关测试与构建，已提交（f928797；公共面核实为零破坏的包内私有类型收窄，细节见 P1.4 小节）。切片 P2.1（测试归位 trace 半：根 `src/__tests__` 4 个 monitoring 单模块测试迁入 `src/monitoring/__tests__`，新增居所闸 `test-residence.test.ts`，gates/core 等其余模块目录未执法）已实现并通过相关测试与构建，已提交（5a8b959）。切片 P2.2（测试归位 gates 半：根 `src/__tests__` 5 个 `*-gate.test.ts` 迁入 `src/gates/__tests__`，居所闸 `ENFORCED_MODULES` 加入 `gates`）已实现并通过相关测试与构建，已提交（8199b60）。切片 P2.3（测试归位 core 半：根 `src/__tests__` 下 14 个 core 单模块测试迁入 `src/core/**/__tests__`，居所闸 `ENFORCED_MODULES` 加入 `core`）已实现并通过相关测试与构建，已提交（4a4a7e4）。切片 P2.4（测试归位 failure/utils 半：根 `src/__tests__` 下 `error-classifier` / `failure-recorder` 迁入 `src/failure/__tests__`、`detect-source-roots` / `exec` 迁入 `src/utils/__tests__`，只改 import 落点与 `failure-recorder` 两个动态 import 的相对深度；`ENFORCED_MODULES` 加入 `failure`——`utils` 是闸的共享层不计段，加进去也是空操作故不加）已实现并通过相关测试与构建，**尚未提交**（等主会话复核；红绿证据在 `.harness/evidence/p2.4-baseline-green.txt` / `p2.4-residence-red.txt` / `p2.4-moved-and-gate-green.txt` / `p2.4-failure-utils-green.txt` / `p2.4-root-green.txt` / `p2.4-build.txt`）。下一切片 = P2.5（CONTEXT 现状清理：P2 第 3 项——`CONTEXT.md` 只留当前职责/契约/依赖、历史挪 ADR/CHANGELOG，含修正 `src/CONTEXT.md:34`「core 被所有模块依赖」与实际依赖不符）。两阶段授权实施（Phase 1/2）按依赖另行排票，不属于 P0.5 本身。本文是开发入口，不代表所有长期方案已经裁决。

## 新会话从这里开始

首个开发切片：**修复“无效证据被判通过”**，顺序为 SecurityGate 缺键假绿、PerformanceGate 陈旧覆盖率。按 TDD 先补会失败的回归测试，再改实现，运行相关测试和构建。完成这个切片后再处理命令执行与凭证漏报，不要直接开始大规模目录迁移。

新会话可直接使用：

```text
阅读 docs/2026-10-26-refactor-review-handoff.md，从“首个开发切片”开始实施。遵守根目录 AGENTS.md 的诊断→修复闸门、测试与文档同步要求；以本文基线为上下文，但先确认工作树和相关源码未发生漂移。
```

开始修改前：

1. 阅读根入口 `AGENTS.md`、`harness/AGENTS.md` 和 `harness/src/CONTEXT.md`；改到具有本目录 `CONTEXT.md` 的模块时同步维护该文档。
2. 执行 `git status --short`，确认是否已有他人改动；不要覆盖未提交工作。
3. 阅读目标实现及其现有测试。本文行号来自上述基线，漂移后以实际代码为准。
4. 根目录规则要求实现前查询 local-rag；当前审查会话没有该工具。新会话若工具可用，查询“安全门禁 假绿 覆盖率 缓存 生命周期 命令执行”。
5. 单票直接在 local master 开发，不主动建分支、不 ship、不直推受保护 master。是否建 issue、提交或上线由用户另行要求。

## 审查结论

现有基础值得保留：显式公共导出、跨目录依赖测试、checker 构造注入、`RunEnv` 运行级只读观察面、git 证据复用和既有批量知识写入。不需要推倒重来。

主要根因不是“目录不够漂亮”，而是：

1. **生命周期不统一**：静态单例、实例 TTL 缓存、手工 CLI 装配和无人消费的 bootstrap 并存。
2. **证据有效性不统一**：解析成功、执行失败、报告缺失和真正通过之间存在假绿路径。
3. **进程信任边界不统一**：固定 argv、shell 字符串、用户输入和入库配置命令混用不同执行方式。
4. **项目文件视图不统一**：部分 checker 已使用 run 级观察面，其他 checker 仍自行遍历、读取和解析。
5. **当前契约与历史记录混放**：测试双居所、CONTEXT 历史叙事增加查找和维护成本。

实施原则：先修错误结论和安全边界，再统一运行模型，最后整理目录。避免一次性全仓搬家。

## P0：正确性与安全

### P0.1 SecurityGate：合法 JSON 缺 `vulnerabilities` 会假绿

证据：

- `src/gates/security.ts:171-193`：只要求 JSON 顶层是对象；没有 `vulnerabilities` 时保留全零统计。
- `src/gates/security.ts:94-103`：全零统计满足阈值后输出“安全扫描通过”。
- npm registry/认证失败可能输出带 `error` 的 JSON；自定义扫描器也可能返回其他合法 JSON 形状。

根因：把“输出可解析”误当成“扫描结果有效”。

目标语义：

- 包含有效 `vulnerabilities` 对象：按漏洞统计和阈值判定。
- 非 JSON、非对象、缺少 `vulnerabilities`、扫描器错误：门禁失败或无法判定，绝不能通过。
- 保持现有三态决策出口和错误信息风格，不新增另一套结果协议。
- 补回归测试：`{}`、`{"error":{...}}`、合法空 `vulnerabilities`；最后一种才是有效零漏洞结果。

完成标准：上述测试能区分“无效扫描”和“有效零漏洞”，相关 SecurityGate、CLI security 测试及构建通过。

### P0.2 PerformanceGate：测试失败后可能读取陈旧覆盖率

证据：`src/gates/performance.ts:169-196` 执行 `npm test -- --coverage --coverageReporters=json-summary 2>/dev/null || true`，随后读取项目现有 `coverage/coverage-summary.json`。测试失败时报告可能来自上一次运行。

根因：覆盖率文件没有和本次测试执行建立身份关系。

目标语义：测试命令非零退出或超时，覆盖率即为不可用；不读取残留报告。优先直接检查进程退出状态，删除 `|| true`。若仍需读取报告，确保它由本次执行产生。

完成标准：回归测试证明“旧报告存在 + 本次测试失败”不能判为有效覆盖率；成功执行仍能读取本次报告；相关性能门禁测试通过。

### P0.3 统一安全进程调用，修两处注入

证据：

- `src/cli/commands/security.ts:125-142`：`repoRoot` 插入交给 `execAsync` 的 shell 字符串。
- `src/cli/commands/release.ts:36-45,202-207`：release 使用 `execSync` 字符串；registry 原值重新插值，且临时改写用户 npm 配置，异常路径可能不恢复。

目标：

- 参数通过 `execFile`/`spawn` 的 argv 数组传递，路径和 registry 不进入 shell 字符串。
- release 已使用 `npm publish --registry https://registry.npmjs.org/`，删除前后的 `npm config set` 和恢复步骤，避免修改全局状态。
- 复用或收敛到仓内现有执行工具；先读 `src/utils/exec.ts`，不要另造重复执行器。
- 保留现有可注入执行接缝，测试覆盖特殊字符路径和 registry 恢复值不再被执行。

### P0.4 凭证检查漏报 `secret_key` 键族

证据：`src/core/constraints/checkers/no-hardcoded-credentials.ts:47-48` 的通用赋值模式含 `secret\b`，但 `_` 是单词字符，因此 `SECRET_KEY`、`AWS_SECRET_ACCESS_KEY`、`secret-key` 等不能按预期命中。

目标：补充 `secret[_-]?key` 或等价清晰模式；增加大小写、连字符、AWS/Django 常见命名和占位符不误报测试。保持现有“纯标识符引用宁可放过”的已知取舍，不借本票重写整个检测器。

### P0.5 入库命令的信任模型需要产品裁决

证据：`src/core/constraints/checkers/templated/exec.ts:42-45` 以及 checkpoint command/output handler 会执行项目 YAML 中的 shell 命令。对可信项目这是功能，不应简单定性为漏洞；但不可信仓库中运行 check/validate 等价于执行仓库代码。

暂不在首个切片擅自默认禁用，以免破坏既有工作流。后续需明确选择：显式 `--allow-exec`、只读模式、CI 信任配置或至少显著文档警告。选择后再单独立票实施。

**已裁决（2026-10-26，仅产品裁决，未改代码；默认执行行为不变）**

采用"分阶段显式授权"路线：

- **Phase 1**：新增 `--read-only` 开关 + 执行清单警告。运行 check/validate/report 时列出将要执行的命令；`--read-only` 下不执行。本阶段不改变默认行为，默认仍执行。
- **Phase 2**：默认不执行。本地运行可经人工交互授权；CI 环境必须显式授权（无交互授权渠道）。Phase 1/2 各自单独立票、以小切片实施，按依赖排序另排。
- **未授权时的命令通道区分（Phase 2 语义）**：check/validate 因无法取得证据按非零退出失败；report 不执行命令并明确打印跳过说明，不产生"已检查"假象。
- **report 终态**：默认只读，仅显式授权才执行命令。
- **授权来源白名单**：只允许命令行参数、受管 CI 环境变量、人工交互确认。仓内 YAML 配置的 `exec: allowed` 之类字段**不作为**授权依据——入库配置本身属于不可信输入，不能自证可信。

实施边界：以上只是裁决语义；两个阶段的代码实现均未开始，后续各自另起小切片实施，避免被误解为本项已改代码。

## P1：架构与性能重构

### P1.1 建立唯一装配入口和清晰生命周期

证据：

- `src/bootstrap/bootstrap.ts:54-56` 自述生产调用方不读返回字段；仓内生产代码没有 `bootstrapHarness()` 调用。
- `src/cli/commands/check.ts:130-134` 和 `src/cli/commands/report.ts:48-55` 分别手工创建 `ConstraintChecker(new TraceCollector(...))`。
- `src/core/constraints/checker.ts:47-67` 有静态单例，`checker.ts:339-405` 的模块级公共快捷函数继续使用它。
- `checker.ts:49-50` 用 1 秒 TTL 防跨测试污染，说明 run 级缓存挂在了可能长寿的对象上。
- `src/core/constraints/check-cache.ts` 是实例 TTL Map；`RunEnv` 已有更准确的“一次 run、跑完即弃”语义。

推荐模型：

- `HarnessRuntime`：项目级装配和依赖，不保存一次检查的快照。
- `RunEnv`：一次检查的只读项目观察、证据、缓存，run 结束即弃。
- CLI、库入口和 bootstrap 共用同一装配函数，checker 的 trace 接线只写一次。
- 删除无消费者的静态单例和无人读取字段；公共 API 收缩前检索下游并遵守 semver，不直接当内部删除处理。
- 缓存归属按真实生命周期调整，不用更复杂 TTL 修补串 run 问题。

完成标准：生产装配只有一处；同 run 复用、跨 run 隔离有行为测试；公共导出测试和分层测试同步更新。

**已实施（2026-10-26，未提交）**

- bootstrap 新增唯一装配函数 `assembleConstraintChecker(projectPath)`；CLI check/report 与 `bootstrapHarness(Sync)` 共用，trace 接线只写一次（架构闸 + 行为闸：`src/__tests__/unique-assembly.test.ts`）。
- `srcScan` 缓存从 checker 实例的 CheckCache（TTL 1s + 手工 invalidate）迁到 `RunEnv`（一次 run 一份、跑完即弃）；`CheckCache` 实现及其测试已删除（自 #199 起本非公共导出）。`ConstraintChecker.getInstance()` 与 `checkConstraint`/`checkConstraints`/`collectConstraints` 便捷函数、`HarnessBootstrap` 返回字段全部保留，公共面零收缩。
- 行为闸：`src/core/constraints/__tests__/run-cache-lifecycle.test.ts`（同 run 复用 / 跨 run 隔离 / 全链路相邻两次 checkConstraint 不串缓存）。
- 未做（属其他切片）：HarnessRuntime 独立类型化（本切片以唯一装配函数收口，未新增 runtime 包装类型）、P1.4、P2。

### P1.2 用运行级 ProjectSnapshot 收口文件读取

证据：

- `src/core/constraints/checkers/templated/file-exists.ts:57-59` 只跳过 `node_modules`，会下钻 `.git`、构建产物等。
- `src/utils/file-walk.ts:29-52` 是同步递归；`DEFAULT_SKIP_DIRS` 在 `:62`，但该调用没有使用。
- `src/core/constraints/checkers/templated/regex-scan.ts:63-80` 每个约束自行读取变更文件；glob 匹配在扫描期间重复编译。

只读抽样实测（studio 工作树，非 harness 全量 benchmark）：当前 file-exists 形状约 708ms；跳过 `.git` 后约 53ms；再排除 dist/coverage 后约 24ms。它属于潜在热点：应用层启用 glob 约束时触发，当前内置 check 基线不受同等影响。

目标：

- 在 `RunEnv` 下提供惰性项目快照，统一目录排除、文件清单、文件内容和 diff 解析缓存。
- 多条约束共享一次遍历和同一文件读取；glob 在 checker 创建时编译。
- `.harness` 等受管理隐藏目录必须可匹配，因此不能粗暴设置 `skipHidden:true`；应精确跳过 `.git`，并明确 dist/coverage 等语义。
- 保留 `file-exists` 对文件与目录都可命中的现有契约。

先补遍历行为和复用计数测试，再改实现。不要把所有 fs 访问机械塞进一个巨型对象。

**已实施（2026-10-26，已提交 976228d）**

- 新增 `src/core/constraints/project-snapshot.ts`：`createProjectSnapshot(projectPath)` 一次 run 一份，含文件/目录清单（一次遍历）、`content(rel)`（同文件至多读一次）、`parseDiff(diff)`（同一 diff 至多彩一次）。排除口径钉死：精确跳过 `.git`/`node_modules`，**不排除 dist/coverage**（构建产物是存在性约束的合法判定对象；源码清单的排除归 `srcScan`/`DEFAULT_SKIP_DIRS` 管，两边不互借名单），不设 skipHidden，`.harness` 等受管隐藏目录照常可匹配。
- `RunEnv` 新增 `snapshot()` 观察口（**可选成员**；懒建 + run 内 memo，与 P1.1 `srcScan` 同一生命周期，不另起平行缓存）。`CheckEnv` 经包根公开导出且 extends RunEnv——必需化会让外部手写实现编译失败（破坏性变更），故 `createRunEnv` 生产路径恒提供并共享同一快照，内置 checker 一律经 `projectSnapshotFor()`（run-env.ts）取：提供 = 共享 env memo；未提供（旧式手写实现，兼容边界）= 一次性 fallback、保持旧读取行为，不为兼容路径引入跨调用缓存，也不要求外部消费者立刻改成员。`RunEnv`/`ProjectSnapshot`/`projectSnapshotFor` 均不进包根导出面，`EvidenceProviders` 不变。
- 消费方收口（glob 均在 checker 创建时编译）：`file-exists` 匹配走快照清单（文件/目录都可命中契约不变，`.git` 不再下钻）；`regex-scan` 变更文件内容走 `snapshot().content()`、diff 走 `snapshot().parseDiff()`；`no_hardcoded_credentials` 的 readFileSync + parseUnifiedDiff、`no_test_simplification` 的 parseUnifiedDiff 同样迁到 `projectSnapshotFor()`（检测语义逐字未动，P0.4 占位符/纯标识符取舍原样）。零余留消费的 `templated/glob.ts`（matchGlob 包装）已删。
- 行为闸：`src/core/constraints/__tests__/project-snapshot.test.ts`（17 用例：.git/node_modules 排除、dist/coverage 不排除、.harness 可匹配、文件/目录契约、两约束共享一次遍历/一次读取/一次解析、三内置 checker 共享同一 diff 解析与文件读取、glob 创建期编译、跨 run 隔离、legacy 手写 CheckEnv/RunEnv 不含 snapshot 仍可赋值编译且 checker 经 fallback 照常评估）。旧实现下兼容用例编译期红（snapshot 必需化阻断 legacy env）。
- 未做（属其他切片）：P1.4、P2。

### P1.3 知识查询引用记账批量化

证据：`src/knowledge/query.ts:88-92` 对返回的每条知识调用 `recordReference`；`src/knowledge/lifecycle.ts:87-92` 进入 `store.update`；`src/knowledge/store.ts:482-491` 每次更新都全量重写 `index.json`。N 条结果意味着 N 次同步索引写入。

短期：复用 store 已有批量原语，一次 query 收集引用更新后一次落盘，保持成熟度和回调语义。长期再评估追加消费事件、异步合并；异步化涉及持久性和失败语义，应单独裁决。

**已实施（2026-10-26，未提交）**

- `lifecycle.ts` 新增 `recordReferences(entryIds, contributor?, success?, source?)`：`recordReference` 的批量形——一次收集 N 条引用、结束一次 `store.applyAll()` 落盘（复用 #134 批量原语，循环内零逐条写）。逐项语义与逐条版逐字对齐：same-day refKey 去重（去重时 `success` 给定额补记 executionResults，不触发回调）、referencedBy 20 条上限、contributors 去重加项、回调在批量落盘成功后逐条触发（fail-open attempt 不变；保持的是「回调不早于持久化成功」，逐条版的部分失败时序不声称保留——批量本就改变落盘粒度）、未知 id 跳过、批内同 id 只记一次（与逐条循环结果一致）。`recordReference()` 单事件契约（返回更新后条目 + 触发回调）原样保留，生产无其他调用方。
- `query.ts` `query()` 引用记账从「逐条 `recordReference`」改为单次 `recordReferences(entries.map(id))`，外罩 `attempt` fail-open 不变；缓存命中路径（不记账）、search()（searching is not citing，无引用副作用）语义未动。
- 行为闸：`query.test.ts` 新增「引用记账批量化（P1.3）」块（N 条只走一次 applyAll 且 update 零调用[旧实现红]、每条持久化 lastReferenced/referencedBy、空结果零写入、同日重复 query 去重零写入且回调不重复触发、引用驱动成熟度晋升仍成立、记账抛错 fail-open 不影响结果返回）；`lifecycle.test.ts` 新增 `recordReferences` 块（一次落盘 stringify 1 次、空批/未知 id 零读写、去重零写入不触发回调、去重带 success 补记 executionResults、带 success 逐条触发回调、批内同 id 只记一次、回调执行时 store.get 已可见本次引用[旧实现红：回调先于落盘触发]、applyAll 抛错回调不触发且异常外抛[旧实现红]）。旧实现下 query 块 3 条写计数用例红灯（N=4 时 4 次 update / 全量重写）。
- 未做（本切片范围外）：异步化/消费事件重构（留长期裁决）、`ingest.mergeEntries()` 逐条写点（另票）、`store.list()` O(N²) `findFile`（按 #134 裁决未动）。

### P1.4 收窄 GateContext

证据：`src/gates/types.ts:100-134` 注释要求配置走构造器，同一接口却包含六种门禁专属字段。

目标：公共上下文保留真正共享的 `projectPath/taskId/runEnv`；各门禁声明自己的输入类型。统一 `evaluate → GateDecision` 协议，不用字段包统一异构参数。此改动影响公共类型，先查公共面测试和下游消费者。

**已实施（2026-10-26，未提交）**

- 公共面核实结论：`GateContext` / `AcceptanceGateContext` 均非包根可导入类型——`package.json` exports 只登记 `.`，`src/index.ts` 门禁相关导出仅 passes-gate 一族，`src/__tests__/public-exports.test.ts` 以 `@ts-expect-error` 编译期钉住「不可从包根导入」，`./gates` 子路径入口已随 #199 摘除。下游消费核实：studio 171 处 `@dommaker/harness` 引用无一是 gates 协议类型（仅 knowledge/constraint/passes-gate/bootstrap 与出厂 hook shim），deepseek-harness 零引用。**本次为包内私有类型收窄，零公共契约破坏**，无需 semver 破坏性变更流程。
- `src/gates/types.ts`：`GateContext` 收窄为 `projectPath/taskId/runEnv` 三字段；新增专属输入类型 `ReviewGateContext.prNumber?` / `SecurityGateContext.securityScanCommand?` / `PerformanceGateContext.performanceThresholds?` / `ContractGateContext.oldContractPath?|newContractPath?` / `CommandGateContext.command`（必填）/ `AcceptanceGateContext extends GateContext`（原形状并入，多了继承的 `runEnv`）。六个门禁类的 `evaluate()`（及各自 `check()`/`scan()`）收窄收自己的输入类型；`Gate` 接口协议（id/order/evaluate → GateDecision）不动，TS 方法参数双变允许实现收窄。**未解决（本片不声称已解决，也不新增任务）**：各实现用专属输入类型而 `Gate` 抽象仍是宽 `GateContext`，当前又无经 `Gate` 多态调 `evaluate` 的生产消费者，故专属必填字段（如 `command`）在抽象层没有静态校验——若未来出现链式/多态调用方，须先收紧接口形状或调用契约。限制已写进 `Gate` 接口注释（types.ts）与 `src/gates/CONTEXT.md` 统一协议条目。
- 行为与配置优先级逐字保留：SecurityGate 三级链（context 覆盖 > 构造器 > 探测）、PerformanceGate `context.performanceThresholds ?? config.thresholds`、ContractGate `context.newContractPath ?? 构造器 contractPath 锚 projectPath`、CommandGate `command` 改必填（调用方全部已传，删掉 `?? ''`）、SpecAcceptanceGate evaluate 不再 remap 直通 `check()`。CLI 六命令 evaluate 调用点原样编译通过，真实 CLI 冒烟（command/contract）行为不变。
- 顺带修复基线已红的 6 个 gates 测试套件（非本切片引入，HEAD 即红）：P0.3 给 `src/utils/exec` 加 `execFileAsync`（promisify(execFile)）后，`__tests__` 里 6 处 `jest.mock('child_process', () => ({ exec: jest.fn() }))` 工厂不含 `execFile`，模块加载即 TypeError——补 `execFile: jest.fn()` 后全绿。
- 机器可检：新增 `src/gates/__tests__/gate-context-narrowing.test.ts`（7 个专属字段的 `@ts-expect-error` 编译期钉 + 6 个专属输入类型正钉 + types.ts 源码闸 + 3 条行为钉：CommandGate 构造器 ignoreCategories 经 evaluate 生效、SecurityGate 构造器 scanCommand 生效、输入字段覆盖构造器）。旧实现下编译期钉全部红灯（unused @ts-expect-error + 符号不存在）。
- 未做（属其他切片）：P0.5 授权实施（两阶段 Phase 1/2 按依赖另行排票）、P2 剩余项（P2.1 已提交 5a8b959，P2.2 已提交 8199b60，P2.3 core 半已提交 4a4a7e4；failure/utils 归位 P2.4 未提交；CONTEXT 清理=P2.5 未做）。

## P2：目录、测试与文档

1. `bootstrap/` 应成为真实组合根；`cli/` 只负责参数、调用和展示。不要为了目录整齐再建一套 runtime 包装。
2. 模块测试归对应目录 `__tests__`；根 `src/__tests__` 只留分层、公共导出等跨模块架构测试。当前 trace 和多个 gate 测试双居所并存。**进展（2026-10-26）：trace 半已完成**（P2.1，已提交 5a8b959）——`trace-analyzer` / `trace-analyzer-extra` / `trace-collector` / `traces`（改名 `traces-extra`）迁入 `src/monitoring/__tests__`，新增居所闸 `src/__tests__/test-residence.test.ts`（`ENFORCED_MODULES` 从 `monitoring` 起分批执法）。**gates 半已完成**（P2.2，已提交 8199b60）——5 个 `*-gate.test.ts` 迁入 `src/gates/__tests__`（只改 import 落点），`ENFORCED_MODULES` 加 `gates`；注意 `security-gate.test.ts` 全文件 `it.skip`（基线即如此）且与 `security.test.ts` 内容重叠，按「保留并存、去重另案」未动。**core 半已完成**（P2.3，已提交 4a4a7e4）——14 个根测试迁入 `src/core/**/__tests__`（`checker`/`checker-extra`/`iron-laws` → `constraints/__tests__`；`checkpoint`/`cso-validator`/`passes-gate-check` → `validators/__tests__`；`passes-gate` 与既有 `validators/__tests__/passes-gate.test.ts` 重名，按「保留并存、不删重复」改名 `passes-gate-run-tests.test.ts`；其余 7 个 → `core/__tests__`），只改 import 落点与 `exec-checker-full-chain` 的 `__dirname` fixtures 路径；`ENFORCED_MODULES` 加 `core`（现 `['monitoring','gates','core']`）。已知闸口径盲区（与 P2.1/P2.2 同）：动态 `import('...')` 不进 `from|require` 正则，`retired-constraints` 的「从包根导出」用例靠 `await import('../../index')` 仍判 core 单模块——语义上合理（测的是 core 符号的包根可达性），暂不扩正则。**failure/utils 半已完成**（P2.4，未提交）——`error-classifier` / `failure-recorder` → `src/failure/__tests__`（目标目录既有 `recorder.test.ts` 是 harness#96 坏行容错另一测试，不冲突不重名）；`detect-source-roots` / `exec` → `src/utils/__tests__`；`ENFORCED_MODULES` 现 `['monitoring','gates','core','failure']`。留根清单（均为跨模块/架构/公共面/bin/仓库级）：`checker-primitives-sdk`（包根公共面）、`install-precommit-hook`（bin 脚本）、`layering`（分层）、`no-studio-references`（仓库级）、`pretool-use-hook`（gates+monitoring 跨模块）、`public-exports` / `public-type-surface` / `public-value-surface` / `usage-report-public-export`（公共面）、`skip-semantics`（core+monitoring 跨模块）、`sub-barrels-explicit`（barrel 架构）、`test-fixture-hygiene`（夹具纪律仓库级）、`test-residence`（闸本体）、`unique-assembly`（装配架构，虽只 import `../bootstrap` 但属跨模块架构测试，bootstrap 不入 ENFORCED）。剩余：P2 第 3 项 CONTEXT 清理（P2.5，原编号 P2.4）。
3. `CONTEXT.md` 只描述当前职责、契约和依赖；历史放 ADR/CHANGELOG。`src/CONTEXT.md:34`“core 被所有模块依赖”与实际依赖不符，应修正。（=P2.5，原编号 P2.4）
4. `sync-docs` 的采集和判定目前分处 CLI/core，可逐步收成一个文档同步模块，CLI 保留输出。优先级低于 P0/P1。
5. 不合并已明确分工的 `sdd/index-generator.ts` 与 `knowledge/index-generator.ts`；不要为少量重复引入通用框架。

## 验证记录与要求

审查时已运行：

```bash
npm test -- --runInBand \
  src/gates/__tests__/security.test.ts \
  src/gates/__tests__/performance.test.ts \
  src/core/constraints/checkers/__tests__/no-hardcoded-credentials.test.ts
```

结果：3 suites、59 tests 全部通过。它证明当前基线稳定，也证明上述假绿/漏报缺少对应回归覆盖；不能据此否定发现。

每个开发切片：

- 先新增能复现问题的测试并确认旧实现下失败。
- 收尾只跑改动文件及直接依赖它的相关测试，再跑 `npm run build`；按根目录规则不默认跑全量套件。
- 同步相关 `CONTEXT.md`、公共导出/分层测试；若改变既定架构决策，新增或修订 ADR。
- 新文件必须有测试；不凭记忆声称完成。
- 涉安全公开文字遵守根目录脱敏规则，不写具体利用链、机器路径或“实测可达”类公开确认；私有细节落 `studio-config/security/`。本交接文档包含仓库内源码定位，公开提交前须按安全内容闸审查并泛化必要措辞。

## 不在本次结论中的事项

- 没有执行完整测试套件、完整性能基准或真实漏洞利用。
- 没有修改文件、创建 issue、提交或发布。
- 708/53/24ms 是一次只读抽样，不应写成稳定 SLA。
- P1/P2 是推荐方向，不是已经批准的破坏性公共 API 变更。
- 先交付可验证的小切片；每个切片完成后依据实际结果重新排序，不机械执行整份清单。
