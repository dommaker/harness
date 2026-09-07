# core/

## 职责
约束引擎核心：check/prompt 二元约束系统（ADR-0001）、生效集合并（effective-constraints）、检查点验证器(CSO/passes-gate)、会话管理、Spec 验证器、项目配置加载。

## 核心导出
- `constraints/` — 约束定义(IRON_LAWS/GUIDELINES/PROMPTS) + 检查引擎(ConstraintChecker，拦截统一由 checkBeforeExecution 承担，ADR-0004) + 缓存(CheckCache：TTL 缓存 + 计数采样，H6/G5 起公开导出) + 注入渲染(injection-renderer) + 落点写入器(injection-writer：「声明→对照→幂等替换」中 marker-range 替换的唯一 writer——replaceStandaloneRange/replaceEnclosedRange/cutMarkerBlock + 半标记守护；落点路由读写两侧同住此模块 resolveInjectionTarget(CLAUDE.md 有标记段优先、否则 AGENTS.md PRESERVE:governance，studio #307)/resolveGovernanceLanding(init 写侧，含旧版无标记 Governance Rules 块豁免)，ADR-0011) + Agent prompt 渲染(agent-prompt-renderer：trigger 参数化分组渲染，role 路由留 studio，H6/G6)/漂移校验(injection-drift：纯检测只读，路由消费 injection-writer)/使用统计(usage-report：constraints report·retire 的只读数据层，读 trace 两个入口——`readProjectTracesReport()` 带 `skippedLines`、`readProjectTraces()` 兼容包装丢计数；报告模型 `ConstraintsUsageReport` 的降级位 = `traceFileExists` + `skippedLines`，harness#100)/清单对照(capabilities-reconcile：CAPABILITIES.md 与代码实况的覆盖/幽灵判定唯一实现，capability_sync·docs_freshness·sync-docs 共消费，ADR-0009)；CheckEnv 生产侧唯一构造点 `buildCheckEnv(context, providers|'none')`（checkers/types.ts：providers = 证据接线，git 两项绑 GitEvidence 实例，'none' = 显式不接 → evidence flag checker 按契约 skip）
- `git-evidence.ts` — 全仓唯一 git 取证点（#87）：`createGitEvidence(projectPath, run?)` 返回 `GitEvidence{stagedDiff, changedFileNames(staged), headDirs}`，seam 上两个真 adapter（缺省 `realGitCommandRunner` 走真 git / 注入 runner 供计数与替身）。命令级 memo 落在此实例（含失败结果），实例生命周期 = 一次 check run，故 context-builder 与 ConstraintChecker 传同一实例即共用证据；判定语义与迁移前一致（diff 取证失败 → 空串，`git ls-tree` 失败 → null = 所有目录视为新）；`parseHeadDirs`/`splitFileNames` 是配套纯函数
- `constraints/context-builder.ts` — 只装配不取证：`buildConstraintContext(options.evidence?)` 与 `detectTrigger(options.evidence?)` 经 GitEvidence 取 git 事实（不传 = 自建真 adapter），本模块无 child_process import；其余证据标志（traces/文档标记）仍为本地探测
- `effective-constraints.ts` — `getEffectiveConstraints(projectRoot, {preset?})`：全仓唯一生效集来源（内置 → preset → config.yml 禁用（内置与 custom 同效）→ custom 追加（禁用/已退役的不追加）→ scenes 过滤）；`getMergedConstraintsConfig(projectRoot, {preset?})`：同链路的完整 MergedConstraintsConfig 形状（含 disabled/custom/unknownIds），内置工单 23 优先级规则（--preset 仅在无项目自定义配置时生效），check 命令经此入口；`lintEffectiveConfig` 配置诊断
- `effective-set.ts` — `filterEnabledEntries(knownIds, entries, {onUnknownId})`：约束侧（collect）与门禁侧（throw）共用的 config 条目筛选器
- `validators/` — checkpoints、passes-gate、CSO 验证器；`test-output.ts` —「测试产物解读」唯一实现：`extractFailures` 提取函数 + `judgeTestRun` 判定入口（退出码为主 + 行首锚定的文本失败信号交叉否决；文本救不回非零退出，`allowPartialPass` 只作用于文本否决那一维），passes-gate 与 `gates/acceptance` 的结论一律从它取、各自体内不写判定 `if`（解析收口 ADR-0012，判定依据 ADR-0014）；**不读覆盖率**——harness 核心判定对覆盖率不取数不执法，判覆盖率的两处（CLI `passes-gate --coverage`、`gates/performance`）各自读 json-summary，`extractCoverage` 与 `TaskTestResult.coverage` 已随 ADR-0015 删除；`PassesGate.runTests(workDir)` 的执行与证据落盘根是**必传形参**，本层不再取 cwd（harness#95，约定正本见 `src/cli/commands/CONTEXT.md`）；包内模块，不进 `src/index.ts` 导出面
- `session/` — 会话管理
- `spec/validator` — SpecValidator
- `project-config-loader` — 项目配置加载 + 约束合并（mergeConstraints 内含 preset 裁剪：presets/ 纯数据 + 未知名回落 standard，禁用到未知 id 经 effective-set 共享筛选器 collect 模式）；`getGovernanceConfig` 是全仓唯一允许手写钻取 `config.governance` 的点（工单 84），消费方一律经它或经 `resolveContextFiles`（三态：unconfigured / enabled-empty / enabled，dirs 元素类型在此收口）取数据，不得再自己 cast `Record<string, unknown>`；checker 对前两态一律 skip，自动探测回落只属于 init/扫描类工具流调用方

## 依赖关系
- 被所有模块依赖（基础层，无上层依赖）
- 依赖 `src/types/` 类型定义
- 依赖 `src/utils/` 工具函数
- 对 `cli/`、`gates/`、`monitoring/` **零值导入**（type-only 允许）：方向由 eslint.config.mjs 的 `@typescript-eslint/no-restricted-imports`（error 级）锁死，守卫测试见 `src/__tests__/layering.test.ts`（harness#88）

## 约定
- 约束定义在 `constraints/definitions/{iron-laws,guidelines,prompts}.ts`，不在运行时代码中定义
- check 层必须带真实 checker（注册表闭环，引用未注册 checker 构建报错）
- Iron Law 违规必须 throw ConstraintViolationError
- 上行数据一律注入，不在 core 内 require 上层（harness#88）：trace 记录器经 `ConstraintChecker` 构造参数注入（缺省 no-op，`getInstance()`/`constraintChecker` 即未接线的默认实例，只评估不写 trace），真实收集器由组合根接线（CLI check/report、`bootstrapHarness`）；CAPABILITIES.md 能力清单计数经 `capabilities-parser` 的 `CapabilityDefinitionSource` 由 cli 侧注入定义表
- git 事实只能经 `constraints/git-evidence.ts` 的 adapter 取（#87）：core/cli 内不得出现 `execSync('git …')`；一次 run 一份实例、沿调用链显式传递（CLI check → buildConstraintContext → checkConstraints），memo 既不做成模块级全局也不做成单例字段

## 注意事项
- 零 Token 成本：所有分析纯文件操作，无 LLM 调用
- 约束配置支持 .harness/config.yml 自定义合并（preset 真实生效）
- 存在性探测约束（capability_sync/docs_freshness/context_doc_sync）在约定文件缺失，或 context_files 约定已立但无目标（enabled-empty）时 skip，不计 pass/fail；context_doc_sync 与 docs_freshness 对三态判定同构（工单 84）
