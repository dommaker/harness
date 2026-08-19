# ADR-0005: 删除 guideline 例外机制

- 日期：2026-08-19
- 状态：已接受
- 影响版本：1.2.0（BREAKING）

## 背景

guideline 例外机制（2026-04 引入，2026-05 重构为 `EXCEPTION_FIELD_MAP` 映射表）允许约束声明 `exceptions: string[]`，命中 `ConstraintContext` 对应布尔证据字段时豁免检查。架构评审（2026-08-19）确认：

1. **生产从不触发**：harness 自身与下游 studio 均无任何代码给 24 个证据字段赋值，`checkException` 恒 false，例外分支是死代码。
2. **映射表外例外名永不可能命中**：`context_doc_sync` 声明的 `temp_dir`/`test_dir`/`generated_code` 不在映射表内，即使证据字段接线也命中不了。
3. **4 个月零演进**：映射表重构后无任何字段新增、无任何调用方接线，需求从未出现。

## 决策

全链路物理删除，无 deprecated 过渡期：

- `Constraint.exceptions`、`CustomConstraintDefinition.exceptions`/`extend_exceptions` 两个配置键、`ConstraintContext` 的 24 个布尔证据字段与 `exceptionReason`。
- `EXCEPTION_FIELD_MAP`、`ConstraintChecker.checkException`、`check()` 例外分支、trace 的 `exceptionApplied` 回填。
- 内置约束（guidelines/prompts）上的全部 `exceptions` 声明。
- trace 分析链路的例外统计与滥用检测：`TraceSummary.exceptionCount`/`mostCommonException`、`exception_overuse` 异常类型、`add_exception` 建议动作、`exceptionRate` 阈值、`analyzer-base.findMostCommon`（唯一消费方随删除消失）。
- CLI 展示与 init 模板中教用户写 exceptions 的内容。
- studio 进化管线 applier 预留的 `extend_exceptions` 输出通道同步拆除（studio 侧单独跟进）。

存量配置里写了 `exceptions`/`extend_exceptions` 键的，loader 无 schema 校验，静默忽略，保持该行为、不新增警告。

**关闭的扩展路线**：`skip`（ADR-0001 三态，checker 自治）与 `enabled: false`（按 id 全局禁用）都不能表达条件式豁免，但真实需求从未出现。未来若出现条件豁免需求，应重新设计接线（从证据采集做起），不恢复本机制（git 历史可考）。

## 理由

- 投机性通用：机制为假想需求预留，四个月零接线证明需求不存在；死代码持续产生维护成本（类型面、测试面、文档面）。
- 删除判据与 ADR-0003/0004 一致：生产断链 + 零消费方，直接删优于 deprecated 形式主义。
- trace 滥用检测链检测的是一个恒零的信号，保留只会让 report 噪声看起来像在正常工作。

## 后果

- 对外 breaking：`ConstraintContext` 删 24 字段、`Constraint`/config 各删例外键、trace 类型删字段与枚举值。走 minor 发布 + CHANGELOG 显著标注。
- 生产行为无变化：机制从未触发，删除前后所有检查结果逐位一致。
- 存量配置静默忽略，不报错不警告。

## 明确不做

- prompt 文本（description/promptInjection）中作为行为指导的「例外/不强制」叙述不删——那是给 agent 的文本语义，与已删的执行机制无关。
- `src/tools/definitions/` 下 long-running 工具模板的 `exceptions` 输入参数不属于本机制，不动。
- 版本号与发布由 harness-ship 管理。
