# ADR-0040: 重构班次总决策——fail-fast 取向、兼容性破除与类型收口

- 日期：2026-09-30
- 状态：已接受
- 影响版本：2.0.0（major bump，breaking 清单见 CHANGELOG）
- 关联：ADR-0038（`./gates` 入口收回的前置裁决，本班次连壳删除）；ADR-0022/ADR-0019（「双仓零消费者即删」判据的沿用）；harness#88（分层纪律）、#89（损坏显式上报口径）、#119（吞错把解析 bug 变成永远通过的现场）

## 背景

仓内攒了四类同族旧账：(1) 门禁层残留 `catch(error: any)` / 旧格式兼容分支 / 空壳导出入口；(2) 31 处静默 catch 把真故障吞成「一切正常」；(3) 四个 600–820 行的巨型文件承载多职责；(4) 非测试面 25 处 `any` + 14 处非空断言让类型系统形同虚设。逐张零碎开票修不动——每处个案都能论证「先留着兼容」，只有整班裁决才能收口。本 ADR 是该班次（Phase 1–5，四个实现提交 + 杂项收口）的总决策记录，单点细节见各提交信息与对应 CONTEXT.md。

## 决策

### 1. fail-fast 为默认错误口径，吞错必须记名

- 异常要么抛出，要么经 `utils/attempt` 显式降级并在调用点注明理由；存在性探测用 `existsSync` 而非 try/catch。
- eslint `no-empty` 去掉 `allowEmptyCatch`：空 catch 编译期即拦，不再有「先吞了再说」的灰色地带。
- 损坏 ≠ 缺失：YAML/JSON 清单解析失败一律上抛（harness#89 口径推及全仓），缺失才是可分支的合法输入。
- fail-open 是例外而非常态：仅限 hook 留痕等「执法器自身故障不该误伤被执法方」的场景，逐点记名。

### 2. 兼容性随便破，随 2.0.0 一次出清

沿用 ADR-0022 判据（双仓零编程消费者即删），不再为假想消费者留兼容层：

- `./gates` 子路径入口连壳删除（接 ADR-0038 的面收回：空壳入口既无消费者也无存在理由）；
- `AcceptanceCriteria` 旧格式兼容分支与死配置 `customAcceptanceCriteria` 删除；
- `GateResult.details` 收紧为 `Record<string, unknown>`；
- ingest 返回值改判别联合 `IngestResult`（原实现经 `as any` 偷挂 `__rejected` 私有字段）；
- `CommandIO` 定义正本下沉 `src/types/command-io.ts`（消除 core→cli type-only 上行边，harness#88）；
- 未勾选且无 e2e 的验收条件改为判负（行为变化，原为宽松放过）。

迁移成本有意推向消费方：版本号 bump major 即契约声明，不做双写/别名过渡。

### 3. 类型收口：any/非空断言清零并开闸

非测试面 `any` 与非空断言清零后，eslint 开 `no-explicit-any` / `no-non-null-assertion`（error 级，CI 拦截回灌）。测试面存量（156/270 处）显式豁免冻结——豁免是存量冻结不是许可，新增测试不应再引入。

### 4. 巨型文件按职责拆分，纯移位零逻辑改动

`knowledge.ts`(820) / `sync-docs/index.ts`(616) / `init.ts`(590) / `audit-scoring.ts`(589) 各按职责拆成 3–11 个文件，CLI 懒加载细化到子命令粒度。拆分票不做任何逻辑改动——移位与改逻辑混在一票是评审灾难。

### 5. 平行实现不强行合并（index-generator 裁决）

`sdd/index-generator.ts` 与 `knowledge/index-generator.ts` 形状相似（扫树 → frontmatter → 竖线行 → `_index.md`）但入口模型根本不同（目录即条目 vs 文件即条目；平铺 vs 递归；字段固定 vs 类型推断）。frontmatter 解析已共用 `utils/frontmatter` 正本，剩余相似仅 sanitize 一行；抽共享框架要参数化的恰是两者全部差异，共享核不足 20 行，属投机抽象。裁决：**各自保留，边界写进 CONTEXT.md**（knowledge/CONTEXT.md 约定节），禁止以「统一」为名互搬领域逻辑。

## 理由

- 吞错的代价不对称：吞掉一个解析 bug，换来的是门禁永远通过的错误安全感（#119 实发）；抛出的代价只是一次可见的报错。
- 兼容层的维护成本按「每处个案」隐形累积，且双仓零消费者意味着它服务的是假想用户；major bump 是 semver 给的正当出清通道。
- 类型闸门的价值在「开闸」而不在「清零」——不开闸，清零结果一个月内回灌。
- 拆分与改逻辑分离、平行实现不合并，同一条原则：评审单元要纯。混合票无法回答「这行改动是移位还是行为变化」。

## 影响

- **对消费方**：2.0.0 是 breaking 发布，破坏面逐条见 CHANGELOG `[2.0.0]` 段；双仓核实零消费者的条目无迁移动作，其余按 CHANGELOG 迁移说明适配。
- **对仓内**：eslint 新增三道 error 闸（`no-explicit-any` / `no-non-null-assertion` / 无 allowEmptyCatch 的 `no-empty`），CI 拦截回灌；测试面豁免是冻结不是许可。
- **已知限度（登记，不掩盖）**：fail-fast 化后，此前被吞掉的真实故障会以报错形式浮出——这不是回归，是口径翻转的既定代价；测试面 any/非空断言存量仍在，靠豁免冻结，不回灌即达标。
