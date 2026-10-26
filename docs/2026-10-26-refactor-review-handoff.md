# Harness 架构、性能与安全重构交接

> 日期：2026-10-26
> 仓库：`@dommaker/harness`（本机 checkout）
> 审查基线：`master@b82bf16e7449f4fd19ef873fefab4b3ee311bc88`（`@dommaker/harness` 4.0.1）
> 状态：只读审查完成。切片 P0.1/P0.2/P0.3 已实现并通过相关测试与构建（P0.1/P0.2 已提交，P0.3 尚未提交）；下一片从 P0.4 开始。本文是开发入口，不代表所有长期方案已经裁决。

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

### P1.3 知识查询引用记账批量化

证据：`src/knowledge/query.ts:88-92` 对返回的每条知识调用 `recordReference`；`src/knowledge/lifecycle.ts:87-92` 进入 `store.update`；`src/knowledge/store.ts:482-491` 每次更新都全量重写 `index.json`。N 条结果意味着 N 次同步索引写入。

短期：复用 store 已有批量原语，一次 query 收集引用更新后一次落盘，保持成熟度和回调语义。长期再评估追加消费事件、异步合并；异步化涉及持久性和失败语义，应单独裁决。

### P1.4 收窄 GateContext

证据：`src/gates/types.ts:100-134` 注释要求配置走构造器，同一接口却包含六种门禁专属字段。

目标：公共上下文保留真正共享的 `projectPath/taskId/runEnv`；各门禁声明自己的输入类型。统一 `evaluate → GateDecision` 协议，不用字段包统一异构参数。此改动影响公共类型，先查公共面测试和下游消费者。

## P2：目录、测试与文档

1. `bootstrap/` 应成为真实组合根；`cli/` 只负责参数、调用和展示。不要为了目录整齐再建一套 runtime 包装。
2. 模块测试归对应目录 `__tests__`；根 `src/__tests__` 只留分层、公共导出等跨模块架构测试。当前 trace 和多个 gate 测试双居所并存。
3. `CONTEXT.md` 只描述当前职责、契约和依赖；历史放 ADR/CHANGELOG。`src/CONTEXT.md:34`“core 被所有模块依赖”与实际依赖不符，应修正。
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
