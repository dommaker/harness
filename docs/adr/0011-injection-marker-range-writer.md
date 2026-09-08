# ADR-0011: 治理注入段写入收口——单一 marker-range writer

- 日期：2026-09-02
- 状态：已接受
- 影响版本：随下个 minor 发布（无对外破坏；半标记破损态行为收紧，见「影响」）

## 背景

架构评审（2026-09-02，候选 1，Strong）确认：「注入段住在哪个文件哪对标记里、如何幂等替换」这一个概念分散在 5 个函数、3 个文件——

- `init.ts` 三份手写 marker-slice：`setupClaudeMdOutputStyle`（OUTPUT_STYLE 对）、`setupAgentsMdConstraints`（PRESERVE 外层 + CONSTRAINTS 内层两段嵌套切片）、`setupClaudeMdConstraints`（CONSTRAINTS 对）
- `constraints-retire.ts syncGovernanceInjection` 第四份同款切片
- 落点路由读写各一份：读侧 `injection-drift.resolveInjectionTarget`（CLAUDE 优先），写侧 `setupGovernanceConstraints` 内联再抄（额外承认旧版 `## Governance Rules` 无标记块）

git 热点修复（66eb0e8 尾换行幂等 / 2bd7bcc 半标记守护 / d6e84c7 落点路由）全部集中在该区域——同一规则四处修复要同步四次。且「纯手写段内 HARNESS 标记残缺」时旧实现会**再追加一份注入段**（制造双份正本），CLAUDE.md 标记乱序时切片可产生文本错乱。

## 决策

新增 `src/core/constraints/injection-writer.ts`（包内模块，不进包根导出面）：

- `replaceStandaloneRange(content, begin, end, body)`：区间独立成节的替换（body 含首尾标记，尾文折叠为恰好一个空行）——Output Style 段 / CLAUDE.md 约束段 / retire 注入同步 / AGENTS.md PRESERVE 外层四处消费。
- `replaceEnclosedRange(...)`：区间后紧跟外层收口标记的形状（恰好剥一个换行，手写余文原样落回）——AGENTS.md PRESERVE 段内 CONSTRAINTS 区间消费。两种尾部形状是真实排版约定差异，非"算哪些"的开关。
- `cutMarkerBlock(...)`：完整标记块的 before/inner/after 切分（嵌套段用）。
- `findPair` 统一半标记守护：单边缺失或 END 先于 START → `'half'`，一律拒写并报名字告警；`'absent'` 才走各调用方的追加/迁移/骨架路径。
- 落点路由收口本模块：读侧 `resolveInjectionTarget` 自 injection-drift **迁入**（drift 改为 import，`InjectionFile` 类型经 drift 原路径转发）；写侧新增 `resolveGovernanceLanding`（init 的 CLAUDE.md 标记/旧版 Governance Rules 块判定，语义与原内联一致）。
- 消费方退化：init 三个 writer 与 retire 同步 = 「渲染 body + 调 writer」，手写 `indexOf/slice/replace(^\n)` 数学清零；`setupGovernanceConstraints` 退化为查路由分发两行。

## 理由

- locality：下次标记语义改动（如再引入新标记对）只动一处；deletion test 通过——删掉 writer，复杂度不会消失，只会以四份切片回归。
- 测试面：切片数学/幂等/半标记/路由优先级在纯函数与临时目录上测一次（`__tests__/injection-writer.test.ts`）；init-injection.test 保留为各落点行为面（消息文本、落点选择、幂等结果）。

## 影响

- 行为收紧（预期内，均为破损态）：① CLAUDE.md 存在半/乱序 CONSTRAINTS 标记时不再落回「末尾追加」（旧路径会产生双份正本）；② AGENTS.md PRESERVE 段内半标记同上；③ 各段落点出现半标记时输出「标记残缺…请人工修复」告警。完整标记与无标记两态行为逐字不变。
- `resolveInjectionTarget` 迁移出 injection-drift：包内消费方（retire/drift）import 路径更新；drift 原导出名保留转发（`export type { InjectionFile }`），对外零影响。
- 验证：harness 全量 130 套件绿（+17 例：writer 单测 + 三处半标记守护）；init-injection/constraints-retire 原行为用例未删一条全过，即幂等/落点/消息文本不变。

## 补注（2026-09-03，#83：收口范围含探测器，不只写器）

初版收口只覆盖 marker-range 写器与落点路由；#83（架构评审 2026-09-02 候选 4）确认
「这份文档里有没有治理契约 / 有几个正本标题」的**探测判定**仍手抄 4 份且正则已漂移
（drift 严格版不接受 `\s+`，presence/sync-docs/landing 宽松版接受，双空格标题时两层
可对同一文档给出相反结论），探测一并收进本模块：

- `GOVERNANCE_HEADING` —— 治理标题字面量单一来源；init 三处标题写点（AGENTS.md
  PRESERVE 骨架 / 纯手写段追加 / CLAUDE.md 旧落点）与 check/report 提示文案改引此常量。
- `hasGovernanceContract(content)` —— 宽松谓词（标题 `##\s+` 匹配 或 约束标记文本
  在场），governance_presence / sync-docs 治理计数 / init 落点路由消费。fail-open
  偏向：排版漂移宁可信其有，漏报「约束正本静默丢失」的代价高于误报。
- `countGovernanceHeadings(content)` —— 严格计数（精确拼写 + 行尾锚定），drift
  重复章节检测专用。**两谓词不合一、共享字面量而非共享正则**（triage 裁决
  2026-09-02）：强行统一要么在场守护 fail-open 失效（取严格），要么重复计数引入
  无行尾锚定的误报（取宽松）。
- `hasPreserveBlock(content, name)` —— PRESERVE 块存在性 + 块体非空，收编
  presence checker 的手写区块切片。结束标记契约取独占一行（preserve-block 文档化
  约定）：presence 原「结束标记嵌在行中也算在场」显式收紧为 false，在场守护按契约
  丢失报警。`cutMarkerBlock` / `extractPreserveBlocks` 各自 tri-state / malformed
  报告契约不变，按最小改动不强行下沉同一扫描原语。

一致性边界钉进测试：`##  Governance Rules`（双空格）→ 宽松在场 true 且严格计数 0；
精确拼写 → 两者均认；presence × drift 同 fixture 一致性用例入
governance-presence.test.ts。
