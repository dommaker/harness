# Harness 架构、性能与安全重构交接

> 日期：2026-10-26
> 仓库：`@dommaker/harness`（本机 checkout）
> 审查基线：`master@b82bf16e7449f4fd19ef873fefab4b3ee311bc88`（`@dommaker/harness` 4.0.1）
> 状态：只读审查完成。切片 P0.1–P0.4 已实现并通过相关测试与构建，均已提交。P0.5（入库命令信任模型）已完成产品裁决，记录见 P0.5 小节"已裁决"块——**仅为文档裁决，未改任何代码或默认行为**。切片 P1.1（唯一装配入口与生命周期）已实现并通过相关测试与构建，已提交（d37b830）。切片 P1.2（运行级 ProjectSnapshot 收口文件读取）已实现并通过相关测试与构建，已提交（976228d）。切片 P1.3（知识查询引用记账批量化）已实现并通过相关测试与构建，已提交（7f697f7）。切片 P1.4（收窄 GateContext）已实现并通过相关测试与构建，已提交（f928797；公共面核实为零破坏的包内私有类型收窄，细节见 P1.4 小节）。切片 P2.1（测试归位 trace 半：根 `src/__tests__` 4 个 monitoring 单模块测试迁入 `src/monitoring/__tests__`，新增居所闸 `test-residence.test.ts`，gates/core 等其余模块目录未执法）已实现并通过相关测试与构建，已提交（5a8b959）。切片 P2.2（测试归位 gates 半：根 `src/__tests__` 5 个 `*-gate.test.ts` 迁入 `src/gates/__tests__`，居所闸 `ENFORCED_MODULES` 加入 `gates`）已实现并通过相关测试与构建，已提交（8199b60）。切片 P2.3（测试归位 core 半：根 `src/__tests__` 下 14 个 core 单模块测试迁入 `src/core/**/__tests__`，居所闸 `ENFORCED_MODULES` 加入 `core`）已实现并通过相关测试与构建，已提交（4a4a7e4）。切片 P2.4（测试归位 failure/utils 半：根 `src/__tests__` 下 `error-classifier` / `failure-recorder` 迁入 `src/failure/__tests__`、`detect-source-roots` / `exec` 迁入 `src/utils/__tests__`，只改 import 落点与 `failure-recorder` 两个动态 import 的相对深度；`ENFORCED_MODULES` 加入 `failure`——`utils` 是闸的共享层不计段，加进去也是空操作故不加）已实现并通过相关测试与构建，已提交（571c7cc）。切片 P2.5（CONTEXT 现状清理：P2 第 3 项——根 `src/CONTEXT.md` 依赖描述修正为 layering 登记+实扫口径，历史叙事清为 ADR 指针；依赖描述与登记的文档对照闸加进 `src/__tests__/layering.test.ts`）已实现并通过相关测试与构建，已提交（4ae3005）。切片 P2.6（核心四模块 CONTEXT 清理：`src/core/`、`src/gates/`、`src/bootstrap/`、`src/cli/commands/` 的 CONTEXT.md 历史班次/工单流水账清为 ADR 指针——现行职责、契约、公共面状态、依赖、所有现行约束与例外全保留，并按当前实现修正两处文档漂移：core 依赖关系改为「下行面=types/utils/presets、生产值依赖者=gates/bootstrap/cli」对齐 P2.5 根文档口径、core 公共面透出从「子路径 `@dommaker/harness/core`」改正为包根 `src/index.ts`（`./core` 子路径已摘除）；机器可检形状逐一保全——registry.test.ts 三处正则、`数值旗帜装配口径（harness#152）` 条目名、`核心导出` 节 bullet 解析面、sync-docs contentDrift 对撞）已实现并通过相关测试与构建，已提交（2cd7260；证据在 `.harness/evidence/p2.6-sync-docs-check-baseline.txt` / `p2.6-sync-docs-check.txt` / `p2.6-related-tests.txt` / `p2.6-build.txt`）。切片 P2.7（其余模块 CONTEXT 清理：`src/knowledge/`、`src/monitoring/`、`src/failure/`、`src/context/`、`src/agents/`、`src/release/`、`src/completion-checkers/` 七份同口径清理——历史班次/工单流水账/已完成迁移叙述清为 ADR 指针，现行职责/契约/公共面状态/依赖方向/约束/例外/测试指针全保留；`src/utils/CONTEXT.md` 核实不存在、不新建；`completion-checkers/CONTEXT.md` 复核后确认本已只含现行契约、未改动；机器可检结构全保全——knowledge 的 `<!-- sync-docs:construction-sites FileKnowledgeStore = 1 -->` 标记、各目录 barrel 值符号在「核心导出」节的登记、sync-docs contentDrift 对撞）已实现并通过相关测试与构建（最终 SHA 以 git log 为准，不预写；证据在 `.harness/evidence/p2.7-related-tests.txt` / `p2.7-sync-docs-check.txt` / `p2.7-build.txt`）。下一切片 = P2.8（P2 第 4 项 sync-docs 采集与判定收口）。两阶段授权实施（Phase 1/2）按依赖另行排票，不属于 P0.5 本身。本文是开发入口，不代表所有长期方案已经裁决。

**进展（2026-10-28）：P2.8 已实施并验证**——sync-docs 采集与判定收口：新建 core 内部模块 `src/core/docs-sync/`（`sync-state.ts` 的 `collectSyncState`/`judgeSyncState` 主入口 + `project-reader.ts` 源码清单采集 + `context-collector.ts` CONTEXT 发现/导出面/mtime/构造点计数 + `capabilities-table.ts` file-table 解析/排版判定/compact 折叠 + `agents-syncer.ts` AGENTS.md 生成 + `preserve-block.ts`），CLI `sync-docs/` 只留入口编排/输出（sync-output）/写入（sync-writes + capabilities-syncer、context-syncer 两个写侧残余）/`--gate`/`--compact` 形态；判定与输出契约零变化（`--check`/`--json`/退出码面逐字不变，「未找到 srcDir」警告由输出侧从 `SyncState.missingSrcDirs` 打印，人读 stdout 序不变（--json 下旧实现自多目录扫描起即带 isJson 守卫不打印，行为不变））；`CapabilityDefinitionSource` 仍由 CLI 注入（harness#88 不变）；`--gate` 的 git 取证判定（head-gate.ts）留 CLI 未动——它是 sync-docs CLI 自己的 git 取证与写流程收尾，不在 check 判定链内，**不属于** core/CONTEXT.md git-evidence 记名豁免面（该清单只记 release.ts / gates·cli review.ts / knowledge/cold-start.ts 四处，head-gate 不在其中也不需要在其中）。红→绿 = 新 wiring 闸 `src/cli/commands/__tests__/sync-docs-wiring.test.ts` 四轮（R1 源码/CONTEXT 采集、R2 capabilities 文本判定、R3 AGENTS/PRESERVE、R4 collect/judge 主入口）逐轮先红后绿；3 个采集口径单测随迁 `src/core/docs-sync/__tests__/`。相关测试 17 套件 187 用例全绿 + `sync-docs --check` exit 0 + build 绿，证据在 `.harness/evidence/p2.8-*`。**下一切片 = 最终复审**（P2 项全部落地，复审范围 = 全交接）。

**进展（2026-10-28，复审后修复切片，local master 单独提交）**：最终复审三条意见的处理——① `src/core/CONTEXT.md` 的 context-reconcile / construction-sites 两条「调用方」修正为 `core/docs-sync/context-collector.ts` 的 `collectContextExportSurface` / `createConstructionSiteCounter`（实际已随 P2.8 迁离 `cli/commands/sync-docs/context-syncer.ts`，该文件现只剩写侧 `createContextMd`）；② 复审疑「missing srcDir 警告移出采集后 --json 不再打印」——经 git 史取证**不成立**，不改行为：该警告自多目录扫描引入（旧 sync-docs 采集内联 log）起就带 `if (!isJson)` 守卫，`--json` 下旧实现也不打印，P2.8 移到 `emitHumanReport`（只走人读分支）后行为与顺序一致；按「补公共接缝回归测试」的要求在 `src/cli/commands/__tests__/sync-docs.test.ts` 钉住该行为（人读打印、--json 不打印、JSON 出口不受影响），新测试当前实现即绿；③ 上文 P2.8 块的 head-gate 措辞已改为准确口径（sync-docs CLI 自己的 git 取证与写流程收尾，不在 check 判定链内，不是 core/CONTEXT git-evidence 记名豁免面）。local-rag 本会话不可用，按交接规则仅记录。本片范围外的复审建议（knowledge/lifecycle 重复、middle man 等）不做。本切片证据在 `.harness/evidence/p2.8-review-fix-*`；提交 SHA 以 git log 为准，不预写。

**进展（2026-10-29）：后续架构、性能与安全审查完成**——当前开发基线为 `master@fb6b733`（进入时重新核实）。下一轮不做大规模目录搬迁，优先统一副作用授权、进程结果与证据时效、tasks.yml 契约和 knowledge 批量读写。以下开发队列取代早期“首个开发切片”建议；此前已完成切片只作历史参考。

**进展（2026-10-29）：D1 已实施并由主会话独立验收，未提交**——`SpecAcceptanceGate` 用模块内私有 `tokenizeCommand` 将可信 `e2eTestCommand` 解析为 argv 前缀，`tasks.yml` 的 `e2e_test` / `test_name` 只作为独立 argv 元素追加，经 `execFileAsync` 无 shell 执行；cwd、超时、退出码与 `judgeTestRun` 判定不变。TDD 红→绿及真实 `node` runner 端到端用例已落；主会话复跑 21 个相关套件、220 用例全绿（1 套件/4 用例按基线跳过），build、改动文件 ESLint、`sync-docs --check` 均通过。证据在 `.harness/evidence/d1-*`。local-rag 本会话不可用，按规则记录。遗留边界：可信命令只支持 CONTEXT 已记录的 shell 词法子集，不做变量或命令替换；Windows `.cmd` 未专项覆盖。**下一切片 = D2**。

**进展（2026-10-29）：D2 已实施并经三轮主会话审查后独立验收，未提交**——release 私有 `run` 返回 `{ code, stdout, stderr }`，所有状态变更与证据命令按 `code !== 0` 首败即停（含 fetch/status/tag 证据、build/version、主分支/release 分支/tag push、PR checkout/create、npm publish/view）；仅 GitHub Release 非致命告警和成功后的 remote URL 装饰查询保留降级。构建改走 `<pkgPath>/node_modules/typescript/bin/tsc` + `process.execPath`，缺失即 build 失败，无 npx/隐式下载；stdout-only 错误、无数字退出码、陈旧 dist、成功 stderr 警告均有回归。主会话复跑 3 个相关套件、59 用例全绿，build、改动文件 ESLint、`sync-docs --check` 均通过。证据在 `.harness/evidence/d2-*`；`src/release/integrity.ts` 无需修改。**下一切片 = D3**。

**进展（2026-11-02）：D3 已实施并经主会话实际 diff 审查、回修与独立验收，未提交**——check/validate/report 共用 `CommandExecutionPolicy`，普通模式先列本次触发域内的项目声明命令且默认仍执行；`--read-only` 零命令副作用，三态 skipped 在各自人读/既有 JSON 面明确可见，无实际失败但有策略跳过时返回 `kind:'skip'`（退出 0），不产生完整通过假象。普通 report 字段、Markdown 行和 passed 数值不变；HTTP/custom handler/内部 git 取证不纳入本子进程命令策略。主会话复跑 25 个相关套件、278 用例全绿，build、`sync-docs --check`、真实 bin 的 read-only 与普通模式端到端冒烟均通过。证据在 `.harness/evidence/d3-*`，设计含 HTTP 取舍；local-rag 不可用已记录。**下一切片 = D4**。

**进展（2026-11-03）：D4 已实施并经主会话实际 diff 审查与独立验收，未提交**——SecurityGate 默认 `npm audit` 固定 `--registry https://registry.npmjs.org/`，项目 `.npmrc` 不能改变默认来源，context/构造器自定义扫描命令仍原样下发；PerformanceGate 运行前隔离既有覆盖率报告，只接受本次测试重新生成的 json-summary，失败、超时、成功未生成或损坏均不拿旧报告充数，首次生成与同内容重写有效，失败路径恢复旧文件。主会话复跑 25 个相关套件、262 用例全绿（1 套件/4 用例按基线跳过），build、改动文件 ESLint、`sync-docs --check` 与真实 bin 的 registry/覆盖率端到端场景均通过。证据在 `.harness/evidence/d4-*`；local-rag 工具不可用，按规则记录。**下一切片 = D5**。

**进展（2026-11-03）：D5 已实施并经主会话实际 diff 审查、回修与独立验收，未提交**——`acceptance list` 删除旧 `acceptanceCriteria`/`Object.entries` 形状解析，与 SpecAcceptanceGate 共同消费包内私有 `parseTasksFile`；相对 tasksPath 同锚 projectPath。非法 YAML、顶层形状、任务和验收条件在 list 侧返回既有 `kind:'fail'`（退出 1），不再静默 skip；ENOENT 保留与 gate 一致的跳过语义，D1 argv 边界与三种 checked/e2e 判定不变。主会话复跑 13 个相关套件、152 用例全绿（1 用例按基线跳过），build、改动文件 ESLint、`sync-docs --check` 均通过；真实 bin 验证合法文件两入口同为两任务三条件，四类非法输入在两入口均明确失败且退出 1。严格 TDD 红→绿与主验证据在 `.harness/evidence/d5-*`；local-rag 工具不可用，按规则记录。**下一切片 = D6**。

## 新会话从这里开始：主会话编排，子 agent 实现

新会话可直接使用：

```text
阅读 harness/docs/2026-10-26-refactor-review-handoff.md 的“新会话从这里开始”和当前切片。主会话只负责编排、验收和状态记录；每个实现切片派一个全新的 coder 子 agent 完成。先确认工作树、依赖和源码未漂移，再派发第一张未完成的可用切片。
```

### 主会话职责

1. 阅读根入口 `AGENTS.md`、`harness/AGENTS.md`、`harness/src/CONTEXT.md` 及当前切片涉及的模块文档；执行 `git -C harness status --short --branch`，确认基线与未提交改动。
2. 实现前按根目录规则查询 local-rag；工具不可用时记录，不伪造查询结果。
3. 从下方队列选择第一张未完成且依赖已满足的切片，把**目标、范围、非目标、验收标准和相关文件**完整交给一个全新的 coder 子 agent。子 agent 没有本会话上下文，不能只发切片编号。
4. 同一 checkout 同时只跑一个实现子 agent，切片串行。只读设计、审查可以并行；实现阶段不让多个 agent 交叉改同一工作树。
5. 子 agent 返回后，主会话检查实际 diff、测试输出和文档同步情况，必要时运行独立验收。主会话不直接补实现；需要修改时，把具体 review 意见交回原实现子 agent 修复。
6. 只有实际行为、相关测试、构建和文档全部验收后，才把切片标为完成并记录证据。子 agent 自述完成不等于主会话验收完成。
7. 每张切片结束重新选择下一张，不机械执行整份清单。遇产品语义、公共接口或跨仓变更分歧时先请人裁决。

### 子 agent 工作契约

- 先读适用约束、目标实现和现有测试，以 TDD 先补能复现问题的测试，再改实现。
- 只改本切片范围；同步相关 `CONTEXT.md`，改变既定架构决策时同步 ADR。新文件必须有测试。
- 收尾运行改动文件及直接依赖它的相关测试，再运行 `npm run build`；返回修改文件、红→绿证据、最终测试/构建结果和遗留风险。
- 单票直接在 local master 工作，不新建分支、不 ship、不直推受保护 master。是否建 issue 或提交由用户另行要求。

### 开发队列

状态初始均为 `pending`；主会话验收后改为 `done` 并附提交或证据位置。

#### D1 `done`：E2E 参数与 shell 解耦

- 范围：`src/gates/acceptance.ts` 及直接测试、`src/gates/CONTEXT.md`。
- 目标：`e2eTestCommand` 仍是可信配置；`tasks.yml` 的 `e2e_test` / `test_name` 作为 argv 数据传递，不经过 shell 字符串插值。保留退出码、超时和 `judgeTestRun` 判定语义。
- 验收：特殊字符测试文件与测试名只作为单个参数到达测试运行器；成功、失败、超时回归测试及 build 通过。
- 依赖：无。

#### D2 `done`：发布链统一按退出码判定

- 范围：`src/cli/commands/release.ts`、release 直接测试、`src/release/integrity.ts` 仅在确有必要时调整。
- 目标：进程 helper 返回 `{ code, stdout, stderr }`；build、version、push 等步骤统一以 `code !== 0` 判负。构建使用项目本地确定的 TypeScript 可执行文件，缺失即失败，不隐式下载。
- 验收：错误只出现在 stdout 时构建仍失败；陈旧 dist 不能救活失败构建；成功路径与 dry-run 行为不变；相关测试及 build 通过。
- 依赖：无。

#### D3 `done`：P0.5 Phase 1 副作用授权

- 范围：check / validate / report 的命令执行链、CLI 参数与输出契约；按 P0.5 已裁决语义实施，不进入 Phase 2。
- 目标：组合根形成统一执行策略；运行前列出将执行的命令，新增 `--read-only` 跳过命令执行并明确报告跳过结果。仓内 YAML 只声明命令，不作为授权来源；HTTP 是否纳入同一策略先在实现设计中说明。
- 非目标：本切片不改变默认执行行为，不实现 Phase 2 默认拒绝或交互授权。
- 验收：三条命令的人读/JSON 输出与退出码符合各自既有契约；read-only 下零命令副作用且没有“已检查”假象；普通模式行为兼容；相关测试及 build 通过。
- 依赖：无；若与 D1 并行设计，最终仍串行落盘。
- 完成记录（2026-11-02，未提交）：统一 `CommandExecutionPolicy` 与命令发现/清单，三命令共用 `--read-only` 跳过语义；清单按触发域过滤，read-only 无实际失败但有策略跳过时返回 `kind:'skip'`（既有 bin 映射退出 0），report 仅 read-only 增加 skipped 字段/文案且普通模式形状与数值不变。HTTP/custom handler/内部 git 取证不纳入本子进程命令策略，HTTP 行为未改。严格 TDD 红证据与主审回修红证据分别在 `.harness/evidence/d3-red.txt`、`d3-review-red.txt`；设计（含 HTTP 边界）在 `d3-design.md`。主会话实际 diff 审查后独立复跑 25 个相关套件、278 用例全绿，build、`sync-docs --check` 与真实 bin 端到端冒烟均通过；证据在 `.harness/evidence/d3-main-{tests,build,sync-docs,smoke}.txt`（子 agent 全量相关面证据为 `d3-related-tests.txt`：51 套件、586 用例）。local-rag 工具不可用，已在设计证据中记录。

#### D4 `done`：外部证据来源与本次运行绑定

- 范围：SecurityGate 默认审计命令、PerformanceGate 覆盖率采集及直接测试。
- 目标：默认 npm audit 固定可信 registry；覆盖率报告必须能证明由本次测试执行产生，缺失或未刷新时 fail-loud。自定义扫描命令仍属于显式可信输入。
- 验收：项目 npm 配置不能改变默认审计来源；旧覆盖率 + 本次未生成报告不能判为有效；合法零漏洞和本次有效覆盖率仍可通过；相关测试及 build 通过。
- 依赖：无。
- 完成记录（2026-11-03，未提交）：默认审计命令固定官方 registry，显式自定义命令不追加旗标；覆盖率通过运行前备份旧报告、成功后只读取本次重新出现的报告建立运行身份，失败/超时/未生成/损坏不采用旧报告并恢复备份，同内容重写与首次生成均有效。新增 `security-registry-pin.test.ts` 与 `performance-coverage-freshness.test.ts`，严格 TDD 红证据在 `.harness/evidence/d4-red.txt`。主会话独立复跑 25 套件、262 用例全绿（1 套件/4 用例按基线跳过），build、改动文件 ESLint、`sync-docs --check` 与真实 bin 端到端均通过；主验证据为 `d4-main-{tests,build-lint-syncdocs,e2e}.txt`，完整实现证据为其余 `d4-*`。local-rag 工具不可用，已记录。

#### D5 `done`：tasks.yml 解析回到单一契约

- 范围：`src/gates/tasks-file.ts`、`src/cli/commands/acceptance.ts`、acceptance 直接测试和两处 CONTEXT。
- 目标：gate 与 `acceptance list` 共同消费 `parseTasksFile`；删除 CLI 旧形状解析和解析失败静默 skip。输出文案变化须由测试明确钉住。
- 验收：gate 接受的文件能列出相同任务与验收条件；非法形状一致 fail-fast；相关测试及 build 通过。
- 依赖：无；与 D1 触及同一 gate 文件时排在 D1 后。
- 完成记录（2026-11-03，未提交）：CLI list 直引包内私有 `parseTasksFile`，与 gate 共用新契约 `tasks`/`acceptance` 的解析和形状校验；非法 YAML/形状/任务/条件返回 `kind:'fail'`，ENOENT 保留 skip，普通合法输出列出任务 id、条件描述、勾选状态与 e2e 元数据并由测试钉住。新增 `acceptance-list-tasks-file.test.ts` 以真实每轮唯一 mkdtemp 夹具对拍两个公开入口；严格 TDD 红证据为 `d5-red-1-list-contract.txt`，转绿与回修证据为 `d5-green-*` / `d5-review-*`。主会话独立复跑 13 套件、152 用例全绿（1 用例按基线跳过），build、改动文件 ESLint、`sync-docs --check` 与真实 bin 两入口合法/四类非法场景均通过；主验证据为 `d5-main-{tests,build,eslint,sync-docs,e2e}.txt`。未提交、未建分支、未推送；local-rag 工具不可用，已记录。

#### D6 `done`：knowledge 路径构造收口

- 范围：`src/knowledge/store.ts` 及 store/query/decay 直接测试、`src/knowledge/CONTEXT.md`。
- 目标：index 驱动的读取、写入、删除共用同一受限路径构造；非法 id/type 在读 index 时明确报错并指向重建或修复方式。
- 验收：索引中的非法路径分量不能逃出知识库目录；正常读取、重建、删除和索引漂移错误语义不回归；相关测试及 build 通过。
- 依赖：无；必须先于 D7。
- 完成记录（2026-11-03，未提交）：私有 `entryPath()` 统一 index 驱动读删与全部写入的文件路径，`isUnsafePathComponent()` 统一非法 id/type 判定；空分量、父目录分量、路径分隔符（含反斜杠）与 NUL 均 fail-fast，不再 basename 静默修正。`readIndex()` 在缓存前校验全部在册条目，错误含条目序号/字段/值及手工修复、`harness knowledge index`（rebuildIndex）提示；正常读取/写入/重建/删除和索引缺失、损坏、漂移语义不变。严格 TDD 红证据为 `d6-red-a-write-path.txt` / `d6-red-b-index.txt`，转绿与主审回修证据为 `d6-green-*` / `d6-review-*`。主会话实际 diff 审查后独立复跑 22 套件、599 用例全绿，build、改动文件 ESLint、`sync-docs --check` 均通过；包根公开入口验证正常 CRUD/重建、16 组非法写入及恶意 index 的 get/list/delete 越界防护与修复提示均通过，主验证据为 `d6-main-{tests,build,eslint,sync-docs,e2e}.txt`。未提交、未建分支、未推送；local-rag 工具不可用，已记录。**下一切片 = D7**。

#### D7 `done`：knowledge 批量读写与按需物化

- 范围：`src/knowledge/store.ts`、`ingest.ts`、`query.ts`、`lifecycle.ts` 及直接测试；不把全仓同步 IO 异步化。
- 目标：普通 query 先按 index 元数据过滤、排序和截断，再读取返回条目全文；ingestBatch 每批共享一次磁盘去重视图并统一落盘；引用记账复用已加载条目，消除层间重复读取。保留全文搜索需要扫描全库的语义。
- 编排：先派两个只读设计子 agent 各给一种 interface 方案，主会话按调用方收益、改动集中度和测试面选择后，再派一个实现子 agent；设计阶段不改代码。
- 验收：用 IO 计数测试证明批量读取/索引写入不再随条目数重复放大；重复、merge、auto-fix、引用去重、回调和缓存语义不回归；相关测试及 build 通过。性能数字只作结果说明，不用单次耗时替代行为断言。
- 依赖：D6。
- 完成记录（2026-11-07，未提交）：两份只读设计后选择复用现有 store 原语的收敛方案；普通 query 经共享 index 过滤正本完成过滤/排序/双预算截断，只物化返回集，search 仍扫描全语料。新写与重建的 index 带内部 `tokenCount`（标题、正文分别估算的既有口径），缺该字段的旧索引按用户裁决临时回退旧路径并提示 rebuildIndex，未改公共 `IndexEntry`。ingestBatch 共享一次磁盘视图和虚拟 index，新建/merge/auto-fix 终态批尾一次 `saveAll`；query 引用经预载条目贯穿 lifecycle 与 applyAll，保留去重、executionResults、回调和缓存时序。主审发现同批连续 merge 使用旧基线及虚拟 index 同 id 多计，原 coder 先红后绿修复为按 id 最新状态。严格 TDD 与回修证据为 `d7-{red,green}-*` / `d7-review-{red,green}.txt`；主会话在隔离 HEAD worktree 装入新测试，旧实现 8 项 IO/复用断言按预期失败（`d7-main-old-implementation-red.txt`），计数均包装真实 fs。主会话复跑 25 套件、698 用例全绿，build、改动文件 ESLint、`sync-docs --check` 和包根公开入口 18 项 E2E 全过；证据为 `d7-main-{tests,build,eslint,sync-docs,e2e}.txt`，设计与遗留边界见 `d7-design.md`。D6 路径闸及 index 错误语义未回归；未提交、未建分支、未推送；local-rag 工具不可用，已记录。**D 队列无下一切片；后续独立票另行裁决与排期。**

### 后续独立票，不阻塞上述队列

- studio 约束变更从 CLI 子进程切到 harness 库接口，或经产品裁决收回休眠库面；这是跨仓票，需单独验收。
- 清理零消费 barrel/公共导出、`ConstraintContext` 遗留字段和 utils 层直接输出。
- 更新开发工具链 lockfile 并复核 npm audit；生产依赖本轮审计为零，开发依赖告警不等于运行时可利用。

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

**已实施（2026-10-26，已提交 d37b830）**

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

**已实施（2026-10-26，已提交 7f697f7）**

- `lifecycle.ts` 新增 `recordReferences(entryIds, contributor?, success?, source?)`：`recordReference` 的批量形——一次收集 N 条引用、结束一次 `store.applyAll()` 落盘（复用 #134 批量原语，循环内零逐条写）。逐项语义与逐条版逐字对齐：same-day refKey 去重（去重时 `success` 给定额补记 executionResults，不触发回调）、referencedBy 20 条上限、contributors 去重加项、回调在批量落盘成功后逐条触发（fail-open attempt 不变；保持的是「回调不早于持久化成功」，逐条版的部分失败时序不声称保留——批量本就改变落盘粒度）、未知 id 跳过、批内同 id 只记一次（与逐条循环结果一致）。`recordReference()` 单事件契约（返回更新后条目 + 触发回调）原样保留，生产无其他调用方。
- `query.ts` `query()` 引用记账从「逐条 `recordReference`」改为单次 `recordReferences(entries.map(id))`，外罩 `attempt` fail-open 不变；缓存命中路径（不记账）、search()（searching is not citing，无引用副作用）语义未动。
- 行为闸：`query.test.ts` 新增「引用记账批量化（P1.3）」块（N 条只走一次 applyAll 且 update 零调用[旧实现红]、每条持久化 lastReferenced/referencedBy、空结果零写入、同日重复 query 去重零写入且回调不重复触发、引用驱动成熟度晋升仍成立、记账抛错 fail-open 不影响结果返回）；`lifecycle.test.ts` 新增 `recordReferences` 块（一次落盘 stringify 1 次、空批/未知 id 零读写、去重零写入不触发回调、去重带 success 补记 executionResults、带 success 逐条触发回调、批内同 id 只记一次、回调执行时 store.get 已可见本次引用[旧实现红：回调先于落盘触发]、applyAll 抛错回调不触发且异常外抛[旧实现红]）。旧实现下 query 块 3 条写计数用例红灯（N=4 时 4 次 update / 全量重写）。
- 未做（本切片范围外）：异步化/消费事件重构（留长期裁决）、`ingest.mergeEntries()` 逐条写点（另票）、`store.list()` O(N²) `findFile`（按 #134 裁决未动）。

### P1.4 收窄 GateContext

证据：`src/gates/types.ts:100-134` 注释要求配置走构造器，同一接口却包含六种门禁专属字段。

目标：公共上下文保留真正共享的 `projectPath/taskId/runEnv`；各门禁声明自己的输入类型。统一 `evaluate → GateDecision` 协议，不用字段包统一异构参数。此改动影响公共类型，先查公共面测试和下游消费者。

**已实施（2026-10-26，已提交 f928797）**

- 公共面核实结论：`GateContext` / `AcceptanceGateContext` 均非包根可导入类型——`package.json` exports 只登记 `.`，`src/index.ts` 门禁相关导出仅 passes-gate 一族，`src/__tests__/public-exports.test.ts` 以 `@ts-expect-error` 编译期钉住「不可从包根导入」，`./gates` 子路径入口已随 #199 摘除。下游消费核实：studio 171 处 `@dommaker/harness` 引用无一是 gates 协议类型（仅 knowledge/constraint/passes-gate/bootstrap 与出厂 hook shim），deepseek-harness 零引用。**本次为包内私有类型收窄，零公共契约破坏**，无需 semver 破坏性变更流程。
- `src/gates/types.ts`：`GateContext` 收窄为 `projectPath/taskId/runEnv` 三字段；新增专属输入类型 `ReviewGateContext.prNumber?` / `SecurityGateContext.securityScanCommand?` / `PerformanceGateContext.performanceThresholds?` / `ContractGateContext.oldContractPath?|newContractPath?` / `CommandGateContext.command`（必填）/ `AcceptanceGateContext extends GateContext`（原形状并入，多了继承的 `runEnv`）。六个门禁类的 `evaluate()`（及各自 `check()`/`scan()`）收窄收自己的输入类型；`Gate` 接口协议（id/order/evaluate → GateDecision）不动，TS 方法参数双变允许实现收窄。**未解决（本片不声称已解决，也不新增任务）**：各实现用专属输入类型而 `Gate` 抽象仍是宽 `GateContext`，当前又无经 `Gate` 多态调 `evaluate` 的生产消费者，故专属必填字段（如 `command`）在抽象层没有静态校验——若未来出现链式/多态调用方，须先收紧接口形状或调用契约。限制已写进 `Gate` 接口注释（types.ts）与 `src/gates/CONTEXT.md` 统一协议条目。
- 行为与配置优先级逐字保留：SecurityGate 三级链（context 覆盖 > 构造器 > 探测）、PerformanceGate `context.performanceThresholds ?? config.thresholds`、ContractGate `context.newContractPath ?? 构造器 contractPath 锚 projectPath`、CommandGate `command` 改必填（调用方全部已传，删掉 `?? ''`）、SpecAcceptanceGate evaluate 不再 remap 直通 `check()`。CLI 六命令 evaluate 调用点原样编译通过，真实 CLI 冒烟（command/contract）行为不变。
- 顺带修复基线已红的 6 个 gates 测试套件（非本切片引入，HEAD 即红）：P0.3 给 `src/utils/exec` 加 `execFileAsync`（promisify(execFile)）后，`__tests__` 里 6 处 `jest.mock('child_process', () => ({ exec: jest.fn() }))` 工厂不含 `execFile`，模块加载即 TypeError——补 `execFile: jest.fn()` 后全绿。
- 机器可检：新增 `src/gates/__tests__/gate-context-narrowing.test.ts`（7 个专属字段的 `@ts-expect-error` 编译期钉 + 6 个专属输入类型正钉 + types.ts 源码闸 + 3 条行为钉：CommandGate 构造器 ignoreCategories 经 evaluate 生效、SecurityGate 构造器 scanCommand 生效、输入字段覆盖构造器）。旧实现下编译期钉全部红灯（unused @ts-expect-error + 符号不存在）。
- 未做（属其他切片）：P0.5 授权实施（两阶段 Phase 1/2 按依赖另行排票）、P2 剩余项（P2.1 已提交 5a8b959，P2.2 已提交 8199b60，P2.3 core 半已提交 4a4a7e4；failure/utils 归位 P2.4 已提交 571c7cc；根 CONTEXT 清理 P2.5 已提交 4ae3005，核心模块清理 P2.6 已提交 2cd7260）。

## P2：目录、测试与文档

1. `bootstrap/` 应成为真实组合根；`cli/` 只负责参数、调用和展示。不要为了目录整齐再建一套 runtime 包装。
2. 模块测试归对应目录 `__tests__`；根 `src/__tests__` 只留分层、公共导出等跨模块架构测试。当前 trace 和多个 gate 测试双居所并存。**进展（2026-10-26）：trace 半已完成**（P2.1，已提交 5a8b959）——`trace-analyzer` / `trace-analyzer-extra` / `trace-collector` / `traces`（改名 `traces-extra`）迁入 `src/monitoring/__tests__`，新增居所闸 `src/__tests__/test-residence.test.ts`（`ENFORCED_MODULES` 从 `monitoring` 起分批执法）。**gates 半已完成**（P2.2，已提交 8199b60）——5 个 `*-gate.test.ts` 迁入 `src/gates/__tests__`（只改 import 落点），`ENFORCED_MODULES` 加 `gates`；注意 `security-gate.test.ts` 全文件 `it.skip`（基线即如此）且与 `security.test.ts` 内容重叠，按「保留并存、去重另案」未动。**core 半已完成**（P2.3，已提交 4a4a7e4）——14 个根测试迁入 `src/core/**/__tests__`（`checker`/`checker-extra`/`iron-laws` → `constraints/__tests__`；`checkpoint`/`cso-validator`/`passes-gate-check` → `validators/__tests__`；`passes-gate` 与既有 `validators/__tests__/passes-gate.test.ts` 重名，按「保留并存、不删重复」改名 `passes-gate-run-tests.test.ts`；其余 7 个 → `core/__tests__`），只改 import 落点与 `exec-checker-full-chain` 的 `__dirname` fixtures 路径；`ENFORCED_MODULES` 加 `core`（现 `['monitoring','gates','core']`）。已知闸口径盲区（与 P2.1/P2.2 同）：动态 `import('...')` 不进 `from|require` 正则，`retired-constraints` 的「从包根导出」用例靠 `await import('../../index')` 仍判 core 单模块——语义上合理（测的是 core 符号的包根可达性），暂不扩正则。**failure/utils 半已完成**（P2.4，已提交 571c7cc）——`error-classifier` / `failure-recorder` → `src/failure/__tests__`（目标目录既有 `recorder.test.ts` 是 harness#96 坏行容错另一测试，不冲突不重名）；`detect-source-roots` / `exec` → `src/utils/__tests__`；`ENFORCED_MODULES` 现 `['monitoring','gates','core','failure']`。留根清单（均为跨模块/架构/公共面/bin/仓库级）：`checker-primitives-sdk`（包根公共面）、`install-precommit-hook`（bin 脚本）、`layering`（分层）、`no-studio-references`（仓库级）、`pretool-use-hook`（gates+monitoring 跨模块）、`public-exports` / `public-type-surface` / `public-value-surface` / `usage-report-public-export`（公共面）、`skip-semantics`（core+monitoring 跨模块）、`sub-barrels-explicit`（barrel 架构）、`test-fixture-hygiene`（夹具纪律仓库级）、`test-residence`（闸本体）、`unique-assembly`（装配架构，虽只 import `../bootstrap` 但属跨模块架构测试，bootstrap 不入 ENFORCED）。剩余：P2 第 3 项 CONTEXT 清理（P2.5，原编号 P2.4）。
3. `CONTEXT.md` 只描述当前职责、契约和依赖；历史放 ADR/CHANGELOG。`src/CONTEXT.md:34`“core 被所有模块依赖”与实际依赖不符，应修正。（=P2.5，原编号 P2.4）**进展（2026-10-26）：P2.5 已提交（4ae3005）**——依赖描述改为「下行面=presets/types/utils；core 生产依赖者=gates/bootstrap/cli（+包根 barrel）」，cli 行收窄为真实值导入面；术语表班次流水账（run env / StateIO / 测试夹具 / pretool-use-hook）清为 ADR-0023/0026/0029/0031/0041 指针，当前契约（五观察口、snapshot 可选成员与排除口径、只读硬契约+StateIO 写口、RunTarget 包内类型等）全保留；防回归闸 = layering.test.ts 新增「文档对照」describe（旧文档下 2 用例红、新文档绿）。**P2.6 已提交（2cd7260）**——core/gates/bootstrap/cli/commands 四模块 CONTEXT 同口径清理（历史班次/工单流水账 → ADR 指针；现行契约/例外/闸测试指针全保留；顺带修正 core 依赖关系与公共面透出两处文档漂移），验证 = sync-docs --check exit 0 + 11 个相关测试套件 179 用例全绿 + build 绿，证据在 `.harness/evidence/p2.6-*`。**P2.7 已实施并验证**——knowledge/monitoring/failure/context/agents/release/completion-checkers 七份（实际改动六份，completion-checkers 复核后确认本已只含现行契约、零改动；`src/utils/CONTEXT.md` 核实不存在、不为凑范围新建）同口径清理：历史班次（重构 Phase N/班次 3 等）、工单流水账（「本票/前实现经 as any 偷挂」类迁移叙述）清为 ADR 指针，现行行为契约/公共面状态/依赖方向/约束/例外/测试指针全保留；机器可检结构逐一保全——knowledge 构造点标记（`FileKnowledgeStore = 1`，计数未动）、各目录 barrel 值符号登记、sync-docs contentDrift 对撞面。验证 = 相关测试套件全绿 + `node bin/harness.js sync-docs --check` exit 0 + `npm run build` 绿，证据在 `.harness/evidence/p2.7-*`。剩余：P2 第 4 项 sync-docs 采集与判定收口（P2.8）。
4. `sync-docs` 的采集和判定目前分处 CLI/core，可逐步收成一个文档同步模块，CLI 保留输出。优先级低于 P0/P1。**进展（2026-10-28）：P2.8 已实施并验证**——采集与判定收进 core/docs-sync/（详见顶部进展块），CLI 只保留输出/写入/gate/compact；用户可见判定与输出契约不变；证据在 `.harness/evidence/p2.8-*`。剩余：无（本项收口完成，下一切片 = 最终复审）。
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
