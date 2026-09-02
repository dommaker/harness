# ADR-0009: CAPABILITIES.md 与代码的对照判定收敛为单一 module

- 日期：2026-09-02
- 状态：已接受
- 影响版本：待发布（含破坏性变更，见「影响」）

## 背景

架构评审（2026-09-02，候选 2+4）确认「读一份声明、对照文件系统、判定漂移」这一横切概念存在三份独立实现：

- `checkers/capability-sync.ts`：`isCoveredBy`（目录前缀 / 文件边界后缀）+ Step1 增量、Step2 全量；解析用 `secondColumnOnly` 历史读法
- `cli/commands/sync-docs/index.ts`：自称「与 capability_sync checker 同规则」（注释同步），实际覆盖判定更松（裸 basename 相等）、removed 走 basename 对比 + 存在性豁免 + 幽灵清扫三段
- `checkers/docs-freshness.ts`：反向（幽灵）判定第三实现，自带表格正则（不走 capabilities-parser），只查文件条目

同一 bug 类（basename 碰撞、后缀误配、check/fix 不收敛）在多处各修一遍（2026-08-08 studio CI 4 连红、2026-08-04 PR #44）；且因缺独立判定接口，相关测试只能从 `ConstraintChecker.check()` engine facade 间接打进（`checker-extra.test.ts` 膨胀至 1506 行）。与 ADR-0008 收敛的是同款结构病（当时只收了计数，覆盖/幽灵未收）。

另查实：`doc-freshness-check` CLI 命令在 studio/studio-config/CI/模板中零调用，其计数法（grep `program.command(`）与 ADR-0008 定义表口径分叉且已随 ADR-0002/0007 注册表驱动化而必然给错数——一并删除。

## 决策

新增 `src/core/constraints/capabilities-reconcile.ts`（包内模块，不进包根导出面）：

- `reconcileCapabilities({ content, populationFiles, changedFiles?, fileExists?, sourceRoots? })` → `CapabilityVerdict`：一次产出双向判定（代码→文档 `uncoveredFiles/uncoveredDirs/uncoveredChanges`；文档→代码 `deadEntries`），纯函数不做 fs/git IO（存在性经 oracle 注入，缺省退化为清单兜底）。
- 解析口径唯一化：表格所有单元格 + 目录条目；`secondColumnOnly` 历史读法从 capabilities-parser 删除。
- **目录条目恒参与覆盖**（决策修正）：原设计按 mode 开关，实施中发现 sync-docs 在 file 模式本就承认目录条目覆盖（有用例钉住），而 checker 不承认——继续分叉即 check/fix 不收敛（2026-08-04 bug 类）。统一为恒参与，`mode=module/file` 的差异退为调用方取哪份输出形状（目录聚合 vs 逐文件）。
- 幽灵口径从严（统一后唯一的行为收紧，验收时确认可控）：文件与目录条目都判；裸文件名条目按代码实况兜底。
- `significantCodeChanges()`（Step1 增量过滤规则）与 `collectSourceFiles()`（file-walk 统一封装）收在同一 module。
- 三个消费方（capability_sync、docs_freshness、sync-docs）全部改为共消费该判定；`docs-freshness.ts` 私有正则删除。
- 删除 `harness doc-freshness-check` 子命令及其私有 matchGlob/countGrepMatches 重复实现。
- 保持不动：各消费方的文件收集人口（checker `env.srcScan` 不含 .tsx、sync-docs `scanSourceModules` 含——扩展名口径统一属行为变更，另票处理）；listing 格式短路、散文文档放行、零条目门槛、fail-open+warn、skip 存在性探测等既有语义逐条迁入。

## 理由

- 覆盖/幽灵/聚合规则从此只有一份，「同规则靠注释」这一类同步点从结构上消灭（deletion test 通过：删掉重复不会让复杂度消失，只会让它散落回三个调用方）。
- 判定纯函数的 interface 就是测试面：新测试直接喂清单，无 fs/git fixture；两个受牵连检查器的旁测从 1506 行 engine 测中拆出就近（另票按同模式推广其余检查器）。

## 影响

- 行为收紧（预期内）：幽灵判定扩展到目录条目；`deadEntries` 形状统一为文档原样字符串（含 `/` 的登记行报全路径——写回正则兼容，JSON 消费方可见形状变化）。
- 实施验证：harness/studio 基线对比中 `sync-docs --check` 对 studio 多报 1 条未登记文件（`apps/api/src/modules/agents/routes.ts`，被旧 basename 宽松匹配掩盖的真实漂移），`harness check` 两侧输出不变。
- 破坏性变更：`doc-freshness-check` 子命令删除（CHANGELOG 标 `!`，随下个 minor 发布）。
