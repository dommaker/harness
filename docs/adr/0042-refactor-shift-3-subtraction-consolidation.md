# ADR-0042: 重构班次 3 总决策——公共面减法、重复归正本、类型与口径收口

- 日期：2026-10-16
- 状态：已接受
- 影响版本：随下一发布定级（含 breaking：包根导出回收、子路径入口摘除、CheckConfig 判别联合化——清单与迁移说明逐条见 CHANGELOG `[Unreleased]`）
- 关联：ADR-0040/0041（重构班次 1/2，本班是续班）；ADR-0022（零消费即删判据）；ADR-0003（包根显式清单）；ADR-0038（「CLI 可达 ≠ 导出理由」，本班子路径摘除的同型先例）；ADR-0030（diagnoseRetireCandidates 自留退路的触达）

## 背景

ADR-0041 班次收口后，四路全量勘察又攒出一批旧账：死代码三仓 grep（harness + studio + mcp-local-rag 逐符号生产消费核对）、架构分层复查（分层守卫表虚账、types 层残留 type 级互引环）、代码质量面（重复实现、静默吞数、宽类型假值兜底）、遗留线索清点（TODO/FIXME、残句、冻结表死账）。勘察中的三个意外发现一并记名：**open issue = 0**（积压清零，本班全部来自勘察自产）、**生产面 TODO = 0**、**生产面 any/非空断言已清零**（ADR-0040 的 eslint 闸确实挡住了回灌）。同前两班的判断：逐张零碎开票修不动，整班裁决一次收口。本 ADR 是该班次（Phase 1 纯减法 → Phase 2 子路径摘除 → Phase 3 重复合一 → Phase 4 结构归位 → Phase 5 口径与类型 → Phase 6 测试与文档收口）的总决策记录，单点细节见各提交信息（45dc88c / b10bcf7 / ece02f1 / 144375f / d66693b 等）、CHANGELOG 与对应 CONTEXT.md。

## 决策

### 1. Phase 1 纯减法：加载期空转校验不是保护，闭环保护可以改形状不降格

- **gates/registry.ts 整模块删除**（108 行注册表：getGate/listRegisteredGates/registeredGateCount/assertGateRegistryClosed）——三仓零生产 importer：bin 只读 `GATE_DEFINITIONS` 数据表，6 个门禁 CLI 命令直 `new` 实现类，「定义↔实现」双向闭环校验只在测试里跑过。**生产从不触发的加载期校验不是保护**——它保护的场景（定义有、实现没注册）在生产路径上根本走不到。闭环保护不降格、改形状：`__tests__/definitions.test.ts` 断言 id 双向对齐 + CLI module+export 引用可解析（照 cli/commands registry.test.ts 既有做法）+ Gate 接口形状，CLAUDE.md 治理条款同步改口径。
- 零消费面逐组删除：cutMarkerBlock（生产零调用仅自测引用）、SchemaLoader 纯类型、包根 6 组导出回收（pruneTraceLogs/findConstraintsByTrigger/createPassesGate/propagateConfig+HARNESS_CONFIG_FILES/proposalMaterialPath/completion-checkers glob 族，本体有消费者的只摘导出）、diagnoseRetireCandidates（ADR-0030 自留退路触达：CLI 只经 buildConstraintsUsageReport 消费，兼容包装零调用）、constraintChecker 模块级单例导出（getInstance() 保留）。
- 判据不变：三仓 grep 零生产消费即删，复核发现有消费者的跳过记名。

### 2. Phase 2 子路径入口摘除：公共面只剩包根

- `package.json` exports 的 `./core` / `./presets` / `./context` 三条子路径入口删除（同 ADR-0038 摘 `./gates` 例）。实证：studio 73 处 `from '@dommaker/harness'` 全部走包根、零 subpath import；mcp-local-rag 对 harness 零依赖。
- `src/core/index.ts` barrel 连删（唯一消费者是「包根与 ./core 同源」测试）；`src/presets/index.ts` 与 `src/context/index.ts` 保留为仓内 barrel（各有生产消费），仅摘发布出口——**出口与模块组织是两件事**，不为摘出口拆掉仍在用的内部 barrel。
- 公共面冻结闸（public-value-surface / public-type-surface）清单同步收缩，闸本体留守防新增入口绕过登记。

### 3. Phase 3 重复合一：八项各归正本，两处行为变化记名

- 覆盖率取数收口 `gates/coverage.ts` 的 `readCoverageSummaryPct`（原 gates/performance 与 cli/passes-gate 双份）；**行为变化**：报告字段缺失/非数值由 `|| 0` 按 0% 判定改 fail-loud（0% 是「查过了」的结论，不是「没查到」的占位）。
- errorMessage 下沉 utils（20 文件 24 处手写三元）、escapeRegExp 下沉 utils（与 glob-match 不含 `*?` 的变体注释点名区分）、readJsonDocIfExists 新正本收五处 JSON 文档三连（损坏 ≠ 缺失口径不变）、isoDate/compactDate 日期正本、check-handlers failResult 唯一构造、index-generator 双 sanitize 下沉（骨架维持刻意平行不合并，knowledge/CONTEXT.md 约定 46 裁决不动）。
- cli review 复用 gates/review 的 parsePrView；**行为变化**：gh 输出非 JSON 对象/reviews 非数组由静默继续改 fail-fast。

### 4. Phase 4 结构归位：断环、清虚账、并死抽象、拆巨型文件

- **断 types/ ↔ failure/ type 级互引环**：三枚纯类型（ErrorClassificationRule/FailureRecord/ClassificationResult）下移 failure/error-types.ts，types/failure.ts 只剩零依赖路径常量。「type-only 不算依赖」的豁免让环在机器守卫（只查值导入）外空转——types 层回真零依赖。
- **守卫文件自己的纪律**：layering.test.ts 的 DOWNSTREAM 冻结表 context 条目由四边收窄为实扫的 `['utils']`——还清的债不留虚账，虚账会让真债混在噪声里。
- monitoring/analyzer-base 并回 trace-analyzer：为已删的 PerformanceAnalyzer 维持的「镜像同构」抽象层，唯一消费者就是 trace-analyzer。
- 三拆一跳：gates/command.ts 拆 blacklist-rules.ts（数据/判定分离）、doc-freshness/runner.ts 四种检查一型一文、gates/acceptance.ts 拆 tasks-file.ts；**跳过记名**——constraint-lifecycle 的 findRetireTarget 勘察记为「单函数 145 行」，实读仅 11 行（已是 find-constraint 薄投影），勘察结论过期，不拆。
- sync-output 的 jsonOutput 具名接口消灭 6 处重复强转（输出逐字节等价，键序不动）。

### 5. Phase 5 口径与类型收口：静默吞数全改记名露出，宽类型改判别联合

- spec-baseline-check 读失败的源文件由静默低估关键词计数改记名（BaselineIndex 新增 unreadableFiles 取数口，table 进报告体、--json 走 stderr——harness#100 的两类去向）。
- SecurityGate 的 npm audit 畸形条目由 as 伪装成低危漏洞计入 total 改跳过 + skippedMalformed 计数进 details。
- knowledge list/import 的枚举旗帜白名单校验（原 split+as 非法值静默进 filter），非法值 usage-error 点名。
- **CheckConfig 判别联合化（本班最大项，公共类型面 breaking）**：`CheckpointCheck` 由「13 可选字段宽 config」改 type 判别子十成员联合，每成员 config 收窄必填形状，handlers 假值兜底全消；加载路径 `assertCheckpointShape` 按 type 校验必填字段 fail-fast 指名；`CheckConfig` 保留为联合别名兼容类型位引用。**理由**：宽 config 让「这条 check 到底需要哪些字段」只能靠读 handler 实现回答，判别联合把它变成类型本身可答的问题；studio 迁移面（gate-checker.service.ts 原生构造）按 CHANGELOG 说明按 type 补必填字段，TS 报错即指路。
- TaskTestResult/TestResult 近同构不合一、注释划界（产出面 vs 入参面，字段可选性即契约差异，合一必破一边公共面）。

### 6. Phase 6 测试治理与文档收口

- 三处假绿/脆断言修复（非空即绿改窗口断言/删冗余 not.toThrow/非空断言三连改 toMatchObject）。
- 临时目录清理勘察复核：`mkdtemp-cleanup` 在 setupFilesAfterEnv 全局注册，91 个用 mkdtempSync 的测试文件全部已被 afterAll 统一回收覆盖——「11 个文件未接入」的勘察估计过时，**全局机制设计就是不要逐文件接线**（实测运行后 /tmp 无残留），零代码改动。
- 文档漂移修正：gates/CONTEXT.md 的 addRule 残句（ADR-0041 追记已放弃，代码无此方法）、ADR-0026 状态行「代码未落」（state-io.ts 已落、#148 CLOSED）。

## 理由

- **生产从不触发的校验不是保护**（Phase 1 核心判据）：registry 的闭环校验只在测试里跑过——它守护的故障类在真实加载路径上不存在，留着它反而让「注册表」这个不存在的运行期概念占据文档与心智。闭环语义本身有价值，移到测试断言承载后保护力度不变、运行期概念消失。
- **出口与模块组织是两件事**（Phase 2）：子路径 exports 是发布面承诺，仓内 barrel 是 import 路径组织；presets/context barrel 仍有生产消费，摘出口不拆组织。
- **重复实现的漂移是静默的**（同 ADR-0041 理由）：两份覆盖率取数已经各自长出不同的失败口径（`|| 0` vs 超时窄化），继续平行只会让差异更大。
- **宽类型是文档的逃兵**（Phase 5）：`config.x || ''` 的每一处假值兜底都在替「这条 check 需要哪些字段」这个问题给出错误答案（「都可以没有」）；判别联合把答案收回类型。

## 影响

- **对消费方**：breaking 与迁移说明逐条见 CHANGELOG `[Unreleased]`（包根导出回收、子路径入口摘除、CheckConfig 判别联合化、覆盖率口径、parsePrView fail-fast、security skippedMalformed、knowledge 枚举白名单）；三仓核实零消费者的条目无迁移动作。
- **对仓内**：三道公共面冻结闸、knowledge-view 四道源形状闸、layering 守卫表同步收缩；新正本均配测试（零测试新文件不可提交的纪律本班全程成立）。

## 已知限度（登记，不掩盖；明确不做、另开班评估）

- **eslint 三笔明账**：`no-var-requires` 33 处存量（bin 懒加载与测试探针的正当用途与待清混存）、测试面 any 156 + 非空断言 270 显式豁免（豁免不是许可）、分层 no-restricted-imports 规则目前只锁 core 上行边，未扩到其他单元的 DOWNSTREAM 表全覆盖。
- **TraceAnalyzer.analyzeRecentReport 下沉**：形状适合下 core 供无 collector 的消费端，但 studio 有活消费，另票评估。
- **ADR-0034 两条尾巴**（知识飞轮提案链的遗留决策项）未在本班范围。
- **jest 全局 coverage 阈值 50% 与 it.skip 存量**：阈值未随 CI 的 80/85% 口径抬高，skip 用例复活未排期。
- **环境记名**：本机（3.7GB 内存、多 agent 并行）后台/并发跑全量测试有基础设施抖动（进程被 SIGTERM、jest worker 退出告警致退出码非零、真跑 npm 的 e2e 用例间歇判负）——前台跑全量稳定绿；本班各 Phase 的验证口径均为前台全量。
