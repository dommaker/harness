# src/ — Harness Framework Core

## 职责
通用工程约束框架的 TypeScript 核心代码。定义约束系统、检查点验证、质量门控、知识基础设施。

## 核心导出 (dist/)
- `index.ts`: 显式公共导出清单（ADR-0003，禁 `export *`；禁令范围 = src 下全部目录 barrel，闸 = `src/__tests__/sub-barrels-explicit.test.ts`，豁免逐文件记名）
- `core/index.ts`: 核心约束引擎
- `presets/index.ts`: 预设纯数据（strict/standard/relaxed；筛选逻辑统一在 core mergeConstraints）
- `context/index.ts`: 上下文管理
- `pretool-use-hook.ts`: provider PreToolUse 执法脚本（stdin JSON → CommandGate block 级 exit 2，fail-open），编译产物 dist/pretool-use-hook.js 随包出厂，provider hook 配置直接指向包内路径；命中（block/warn/audit）写审计 trace 到 traces.log（汇总 constraintId `command-gate`，evidence 只记规则 id + 命令首 token，留痕失败 fail-open）；非 Bash 工具事件（Edit/Write/apply_patch/MCP）只留痕不拦截（constraintId `tool-event:<tool>`，拦截归 codex 沙箱）。裁决与历史见 ADR-0031

## 目录
| 目录 | 职责 |
|------|------|
| core/ | 约束引擎、检查点验证器、文档同步采集/判定（docs-sync/，P2.8 自 cli 下沉） |
| gates/ | 质量门 (acceptance, command, contract, performance, review, security) |
| monitoring/ | Execution Trace 收集/分析 |
| failure/ | 错误分类、失败记录 |
| context/ | 会话管理 |
| cli/commands/ | 20 个顶层命令（COMMAND_DEFINITIONS 14 + GATE_DEFINITIONS 6）+ constraints 治理子命令 |
| agents/ | Agent 生命周期状态机（5 状态） |
| completion-checkers/ | 提交集收尾软观测三纯判定（tdd-chain / phase-format / contract-presence） |
| bootstrap/ | harness 运行时 bootstrap 组合根（bootstrapHarness；原 hooks/，ADR-0041 Phase 3 正名） |
| knowledge/ | 知识引擎：Store、Query、Lifecycle、Ingest、Audit、ColdStart |
| presets/ | 预设纯数据（strict/standard/relaxed） |
| release/ | 发布物完整性自检（integrity.ts，从包声明面推导关键发布物清单） |
| sdd/ | SDD 索引生成（扫 docs/sdd/*/requirement.md → _index.md；布局与字段约定见 docs/sdd.md；与 knowledge/index-generator 平行不合并是刻意分工，裁决见 knowledge/CONTEXT.md） |
| types/ | 公共类型（checkpoint / command-definition / command-io / constraint / cso / failure / gate / passes-gate / project-config / spec / trace） |
| utils/ | 共享工具（exec / jsonl / json-doc / file-walk / frontmatter / numeric-flag / package-json / package-version / detect-source-roots / glob-match / attempt / clip / diff-parse / guards / log-rotate / yaml-edit / yaml / text / error / date） |
| test-setup/ | 测试夹具层：`project-fixture` 构造临时项目根（config/traces/files 声明式落盘，非缺省根显式 opt-out）、`mkdtemp-cleanup` 统一回收 |

## 依赖关系
- `src/core/` 下行面 = `src/presets/`、`src/types/`、`src/utils/`（对 cli/gates/monitoring/knowledge 等零值导入，type-only 允许；方向由 `src/__tests__/layering.test.ts` 的 DOWNSTREAM 登记 + eslint `no-restricted-imports` 锁死）
- 依赖 `src/core/` 的（生产面值导入）：`src/gates/`、`src/bootstrap/`、`src/cli/`；包根 barrel `src/index.ts` 再导出 core 公共面
- `src/cli/` 是顶层组合面（layering 登记 `cli: ['*']`，可下行任意单元）；真实值导入面 = bootstrap / core / failure / gates / knowledge / monitoring / release / sdd / types / utils

## 术语

词典（#30 术语裁决；详见 `docs/adr/0002-registry-closed-loop.md`）：

| 术语 | 定义 |
|------|------|
| 插件 | harness 扩展点统称 = checker / 门禁(Gate) / 命令(CLI)；非运行时插件容器——harness 是文件驱动 CLI、无常驻进程。hook 一族已退出扩展点统称（ADR-0027/#170 删 hooks 管线面，组合根目录后正名 `src/bootstrap/`） |
| Gate（门禁） | 统一守卫接口 `Gate{id, order, evaluate(ctx)}` → `GateDecision`；统一的是决策协议（id/order/三态），执行细节私有 |
| GateDecision | 三态决策 `deny \| abstain \| ask`；deny 单调（下游不可改回 allow）、ask 枚举预留 fail-closed = deny |
| GateResult | 报告结构（gate/passed/message/details/timestamp/duration），保留为报告层，不作决策 |
| 守卫 guard | 仅 dsh 借鉴语境（工具管线单调守卫），不进入 harness 命名 |
| 回滚 | 分工：版本化回退（单段——yml 数据文件 git 版本化，删段恢复）+ 提案回滚（多段 inverse） |
| 文件驱动 CLI | yml 状态真值 + 一次性进程、无常驻生命周期；故不引 dispose 链（止步档 1） |
| 对照（reconcile） | CAPABILITIES.md 声明与源码实况的双向一致性判定（代码→文档查漏登，文档→代码查幽灵）；唯一实现 `core/constraints/capabilities-reconcile.ts`，capability_sync / docs_freshness / sync-docs 共消费（ADR-0009）。一次 check run 内只算一次，经 `RunEnv.capabilities()` 供给两 checker（ADR-0023 决策 4） |
| 判定证据（evidence） | checker 随判定一并返回的路径级依据（`CheckDetail{pass, evidence}`，harness#119/ADR-0016）；文案由 checker 措辞、消费端只打印，出口 = `ConstraintResult` / CLI 输出 / trace / error 级异常文案。不是第四种统计态：**违规** = 与本次变更有因果（进 pass/fail 分母），**提示** = `pass:true` + evidence（仓库级漂移等无因果缺口，只露出不拦） |
| 测试产物解读（test-output） | 从测试运行器 stdout 读出「过了没 / 哪些失败 / 覆盖率」的判定；唯一实现 `core/validators/test-output.ts`（包内，不进导出面），passes-gate / acceptance 共消费（ADR-0012）。两门禁判定依据不一致待 #93 裁决，覆盖率取数归属待 #94 裁决 |
| 飞轮指标（flywheel） | 知识条目的引用与消费度量（refCoverage / avgRefs / consumptionHitRate）；唯一实现 `knowledge/flywheel-metrics.ts`（包内，不进导出面），canonical 分子为过滤 synthetic 后的 genuine refs，audit D6 / knowledge stats / knowledge health 共消费（ADR-0013，#81） |
| 测试夹具（project fixture） | 临时项目根 + 落盘声明；唯一实现 `test-setup/project-fixture.ts`（测试层，不进导出面）——`config` 槽是 `.harness/config.yml` 落点唯一正本（字符串原样落盘，畸形/脏配置用例依赖此口径），`traces` 槽/`writeProjectTraces` 是 trace 落盘唯一正本（路径锚定 `DEFAULT_TRACE_FILE`、序列化走 `appendJsonl` 生产写链），其余文件走 `files` 相对路径；非缺省根必须经 `parentDir` **显式** opt-out（cwd 锚定用例语义），回收经 `mkdtemp-cleanup` 劫持 |
| 运行级观察面（run env） | 一次 `harness check` 运行内对项目上行数据的只读视图：同一文件至多读一次、跑完即弃、不做进程级全局；懒建 + run 内 memo（一次 run 一份，同 run 复用、跨 run 隔离）。唯一实现 `core/constraints/run-env.ts`，承载 `rawConfig()` / `capabilities(population)` / `sourceRoots()` / `srcScan(root)` / `snapshot()` 观察口；`capabilities()` 一次 run 只算一次、经 `RunEnv.capabilities()` 供给 capability_sync 与 docs_freshness 两 checker（ADR-0023 决策 4）；`srcScan(root)` memo 按源码根分键。`snapshot()` 为**可选成员**（唯一实现 `core/constraints/project-snapshot.ts`）：项目级文件/目录清单 + 文件内容 + diff 解析的 run 内共享读取，精确排除 `.git`/`node_modules`、不排除 dist/coverage（构建产物是存在性约束的合法判定对象），不设 skipHidden 以保住 `.harness` 可匹配；内置 checker（file-exists / regex-scan / no_hardcoded_credentials / no_test_simplification）经 `projectSnapshotFor()` 统一取——提供则共享 env 的 memo，未提供的旧式手写实现落到一次性 fallback。`createRunEnv` 生产路径恒提供 `snapshot()` 并 run 内 memo。`RunTarget`（= `RunEnv` \| 项目根路径）与 `resolveRunEnv()` 是入参形状归一点：传路径 = 每次调用读当下内容；`RunTarget` 为包内类型（原 `./core` 子路径类型导出面已摘除，消费方零引用）。生命周期与 git 证据（#87/ADR-0021）同形：入口构造、沿调用链显式传递、不做模块级全局。与 `CheckEnv` 的分工是构造顺序决定的：`CheckEnv` 含 `context`，而 context 是经本观察面读文件算出的产物，故观察面只承载「不需要 context 就能造」的部分，`CheckEnv` 以 `extends RunEnv` 从它派生（ADR-0023）。**只读是硬契约**：运行期状态文件的写口不走本面，走 StateIO（#148）。缓存归属与观察口演进历史见 ADR-0023 / ADR-0029 / ADR-0041；行为闸 = `core/constraints/__tests__/run-cache-lifecycle.test.ts` / `project-snapshot.test.ts` |
| 状态文件 IO（StateIO） | harness 自身运行期状态文件（`.harness/.state.json`）读写的可注入接缝：`read()`/`write()` 两方法、默认真实 fs 实现 `fileStateIO(projectPath)`、命令可选参数注入（照 `CommandIO` 模式，但不扩 `CommandIO`）；唯一实现 `src/cli/state-io.ts`（cli 层，不进包根导出面），收编 check 智能提示与 status 两个写者，写语义统一为**读-改-写**。决策 = ADR-0026（旧 status 整文件覆写隐患的处置记录在其中）、实现票 #148；与运行级观察面分工：观察面只读项目上行数据，本面管 harness 自身状态、含写 |

## 注意事项
- 公共包，禁止硬编码业务路径
- 错误处理口径（吞错治理 Phase 2）：默认 fail-fast——异常要么抛出，要么经 `utils/attempt` 显式降级并在调用点注明理由；存在性探测用 `existsSync` 而非 try/catch；`catch {}` 空吞由 eslint `no-empty`（无 allowEmptyCatch）直接拦
- 约束定义在 `core/constraints/definitions/{errors,warnings}.ts`（按 severity 分组），不应在运行时代码中定义
- `bin/` 只有 CLI 入口发布到 npm
- `__tests__` 的文件系统夹具根一律经 `fs.mkdtempSync` 取每轮唯一目录（缺省父目录 = tmpdir；被测语义本身是 cwd 相对解析的，才显式 opt-out 留在 cwd），固定名会在并发/被 kill 的运行之间互删或被复用成脏夹具；闸 = `__tests__/test-fixture-hygiene.test.ts`（harness#145）
