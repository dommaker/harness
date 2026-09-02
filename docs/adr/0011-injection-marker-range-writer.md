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
