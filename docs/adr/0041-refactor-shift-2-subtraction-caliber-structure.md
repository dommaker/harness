# ADR-0041: 重构班次 2 总决策——减法判据、口径修复与结构归位

- 日期：2026-10-08
- 状态：已接受
- 影响版本：3.0.0 预案（major bump，breaking 清单逐条见 CHANGELOG `[Unreleased]`）
- 关联：ADR-0040（重构班次 1，本班次是其续班）；ADR-0022（「双仓零消费者即删」判据）；ADR-0020/ADR-0025（判定住 core、采集住 cli 的格局来源）；ADR-0035（channel 通道模型，kind 出清后的判定轴）；harness#134（KnowledgeAudit 收 store，audit 为健康面唯一正本的前置）

## 背景

ADR-0040 班次收口后，三路全量勘察（约 1.5 万行非测试源码逐文件读 + studio/mcp-local-rag 跨仓消费者 grep 核对 + 公共面逐符号消费清点）又攒出一批旧账：零消费死代码（含永远空转的旁车子系统）、超出 ADR-0040「损坏 ≠ 缺失 / fail-fast」口径残留的防御代码与假绿判定、分层倒挂与职责错位的模块、以及四套平行实现里阈值已经漂移的健康面。同上一班的判断：逐张零碎开票修不动，整班裁决一次收口。本 ADR 是该班次（Phase 1 纯减法 → Phase 2 口径修复 → Phase 3 结构归位 → Phase 4 公共面出清 → Phase 5 文档收口）的总决策记录，单点细节见各提交信息、CHANGELOG 与对应 CONTEXT.md。

## 决策

### 1. 减法判据：双仓/三仓 grep 零消费即删，空转旁车按死代码论

- 沿用 ADR-0022 判据并扩到三仓核对（harness + studio + mcp-local-rag）：删除前逐符号 grep 生产消费方，零命中即删；复核发现实际有消费者的条目跳过不删并记名（本班两例：`KnowledgeQuery` 的 `lifecycle?` 注入参数等）。
- **空转旁车 = 死代码**：`ReferenceTracker` 的 `references.jsonl` 从无写入方，record/getReferencesForDecision/updateReferencedBy 三仓零调用——「字段永远为空」的子系统不是「还没接线」，按死代码整体删除。
- 死旗帜/死字段同判据：`ConstraintContext` 六个从不被置位的证据标志（hasRootCauseInvestigation 等）连探测器、`needs.contextFlags` 比对、run-env `traceTail` 整串删除——为死字段做的 fs 探测是白做的开机成本。

### 2. 口径修复：超 ADR-0040 口径的防御逐点记名出清，假绿变真判定

19 点逐点记名（commit 280c6c7 正文即清单），原则两条：

- **假绿 = 门禁永远通过的错误安全感，比报错更贵**：`passes-gate` 覆盖率检查失败/不足由 skip 退 0 改 fail-loud；`spec` 单文件与 staged 验证无效由恒 ok 改 fail；`spec-baseline-check` 识别不了的前置条件由默认 satisfied 改 `undetermined` 类别（单独计数、按未满足处理）；`security audit` 扫描失败（deny 无漏洞清单）如实 fail；未知约束 id 由回假结果改抛错。
- **损坏 ≠ 缺失推及存量**：`validate` 的 checkpoints YAML 损坏、知识 store 索引漂移（在册但文件缺失/不可解析）、import 状态文件损坏，统一由「吞掉当空」改抛出并指路修复入口；catch-all 收窄为只兜合法空（ENOENT / 非 git 仓 / gh 说没有 PR）。
- 预过滤可能关掉判定本身：`audit.run()` 删 `title && type && content != null` 预过滤——它让 D1（frontmatter-missing）在 run() 模式永远打不中；条目缺字段由规则自判。

### 3. 结构归位：消环、下沉、判定/采集分层、正名

- **消环**：governance 访问器族（getGovernanceConfig/resolveContextFiles/getCapabilitiesMode）自 project-config-loader 下移 constraints/governance-accessors，解开 loader→app-constraints-loader→模板注册表→内置 checker 的值级循环；防环独立模块随之并回 checkers 桶。
- **下沉**：CommandDefinition 等 5 个命令定义类型自 cli 下沉 `types/command-definition`（gates/definitions 不再 type-import cli）；`types/failure.ts` 的运行时数据（两 enum + 两份常量）移回 failure/error-types，types 层回零依赖公共类型层。
- **判定住 core、采集住 cli**（ADR-0020/0025 格局推及）：spec-baseline-check 判定纯函数下移 `core/spec/baseline-check`（core/spec/ 现仅此一文）；knowledge 的 store 构造/路径解析拆出 `cli/commands/knowledge/store-access.ts`（与 view 无关，retire/reactivate 写口同走此口）；sync-docs main-flow 按「采集→判定→出口」拆 sync-state/sync-output/sync-writes。
- **正名**：`hooks/` → `bootstrap/`（组合根职责）；`constraints/definitions/{iron-laws,guidelines}.ts` → `{errors,warnings}.ts`（ADR-0029 前三层命名残留）；`knowledge/import.ts` → `cold-start.ts`（与 ingest 近义名混淆）。

### 4. 公共面出清：健康面唯一正本、仪式字段删除、单例壳出清，迁移成本推向消费方

- **knowledge 健康面收口 audit 唯一正本**（harness#134 的终局）：删 `KnowledgeLinter`/`KnowledgeHealthScorer`（被 audit 取代未退役的旧代，检查项为 audit-rules 过期子集、阈值已漂移）与 `ReferenceTracker`；保种——`validateEntry` 并入 `KnowledgeIngest`（检查项逐字保留，返回新类型 `IngestValidationIssue[]`），`knowledge health` 健康分并回 `calculateHealthScore`、过期判定并回 audit-rules `stale-entry`（消掉同库三种过期口径），CLI 只剩采集+输出。**删除正当性的准确口径（2026-10-08 校正）**：三者中仅 `ReferenceTracker` 方法面三仓零调用成立；`KnowledgeLinter`/`KnowledgeHealthScorer` 在 studio 有活消费者（`monitor-system-probes.ts` 健康告警、`knowledge.routes.ts` 的 `POST /knowledge/lint`），其删除正当性来自 #134 audit 唯一正本裁决 + major breaking 通道 + CHANGELOG 逐条迁移说明，而非零消费判据。
- **仪式字段删除**：`Constraint.kind`（ADR-0029 已收窄为 'check' 单值，通道判定走 `isGateConstraint`）；`DEFAULT_TRIGGERS` 硬编码 10 操作清单（trigger 转可选，未声明 = 恒评估，清单漂移口消除）；context 压缩词汇类型（引擎本体已随 ADR-0022 删除）。
- **单例壳出清**：`CheckpointValidator.getInstance()` / `CSOValidator.getInstance()` 删除（无状态类不需要单例）；`SpecValidator` 归位 `cli/commands/spec/validator`（唯一消费方 = spec CLI），其全局可变状态同删。
- 迁移成本有意推向消费方（同 ADR-0040 决策 2）：逐条迁移说明写进 CHANGELOG `[Unreleased]`，不做双写/别名过渡；对「可选链兜底会静默落假绿分支」的消费方写法（如 `CSOValidator?.getInstance?.()`）在 CHANGELOG 里点名警示。

## 理由

- 平行实现的漂移是静默的：四套健康实现（audit/lint/doctor/CLI 内联）各自活着时没人察觉阈值已经分叉——同一库三种过期口径、两套健康分算法，「健康 95 分」在不同入口不是同一个数。唯一正本是唯一能停损的形状。
- 死证据标志管道的成本不对称：六个从不置位的标志各自挂着 fs 探测与 git 取证，每次 check 白做一遍；而删掉它们的代价只是删代码。
- 假绿的代价不对称（同 ADR-0040 理由）：覆盖率门禁未达标退 0，换来的是「质量门已过关」的错误安全感并连烧后续工序；fail 的代价只是一次可见的非零退出。
- 迁移成本推向消费方而非留在 harness：兼容层服务的是假想消费者（三仓 grep 已证零消费），major bump 是 semver 给的正当出清通道。

## 影响

- **对消费方**：breaking 清单与逐条迁移说明见 CHANGELOG `[Unreleased]`（健康面三类删除、`Constraint.kind`、context 词汇类型、验证器单例壳、SpecValidator 归位、`readProjectTraces` 包装、trigger 恒评估等）；双仓/三仓核实零消费者的条目无迁移动作。
- **对仓内**：分层守卫（eslint no-restricted-imports + layering.test.ts）覆盖正名后的 bootstrap；三道公共面冻结闸（public-exports / public-type-surface / public-value-surface）条目同步收缩。
- **已知限度（登记，不掩盖）**：
  - studio 锁 `^2.0.0`，本班次 breaking 暂不感知；3.0.0 发布时按 CHANGELOG 迁移说明逐条适配（CHANGELOG 已对 studio 侧具体改法点名）。
  - 知识库索引漂移现在所有读命令会抛（Phase 2 点 15 的既定代价）：盘上存量脏索引会在升级后首次读取时以报错浮出，修复入口 = `harness knowledge index`（内部调 `store.rebuildIndex()`）。
  - `knowledge health` 健康分切到 audit 口径后数值通常下降——不是质量回归，是尺子换成唯一正本。

## 追记：悬空意图裁决（2026-10-08）

事后对班次 2 全部删除项做历史意图审计（commit pickaxe 查引入史 + studio/mcp-local-rag 跨仓 grep + 按定位文档第一性复核），结论：一项删错恢复，四项确认放弃正确、本节正式记名。

### ingestExternal / sanitizeExternalContent 恢复

`KnowledgeIngest.ingestExternal()` 与 `sanitizeExternalContent()`（连同 barrel 与包根导出）原位恢复，签名与 2.0.0 一致，公共面净效果无 breaking。理由：studio 侧 AS-021 GAP-3 指向的外部知识摄入需求（AS-022 正文 Phase 4「外部知识 + Studio UI」）文档仍挂开，且明确点名复用 harness `ingestExternal()` 的 sanitization；studio 生产代码 `knowledge-singletons.ts` 的 span 包装清单也仍列该方法名。「当前三仓零调用」成立但「需求已死」不成立——删除等于单方面放弃一条挂开的活需求，超出减法判据的授权。判据边界由此补上一条：**零消费判据适用于无文档背书的遗留面；对有活需求文档点名的符号，先核需求状态再论删**。

### 正式放弃四项

- **`CommandGate.addRule()`**：按定位文档 §1 推论——命令钩子壳是过渡件，不再加新功能；运行时加规则是编排，归 studio。本条追记覆盖 ADR-0024 决策 5 的旧口径（彼处留 `addRule()` 作运行时扩展点）。
- **check-cache 计数采样（harness#45 G5）**：无实测性能需求；studio 从未使用该参数、另自建采样缓存（边界盘点 B 项，回收方向是 studio→harness 归并，而非恢复 harness 这份半成品）。
- **trace-analyzer 环比趋势家族（`runHourlySummary`/`saveSummary`/`loadSummary`/`compareWithPrevious`）**：汇总调度与报告分发是编排，归 studio（monitor agent 每日洞察已在做）；harness 留判定纯函数 `summarizeTraces`/`detectTraceAnomalies` 即可。
- **`SessionManager.restoreSession()` + `AgentLifecycle` 的 `FallbackStrategy` 机制**：harness 是文件驱动 CLI、无常驻进程，无会话可恢复；agent 失败重试/降级是编排决策，归 studio agent-loop。两者属长错地方的越界物，不留。
