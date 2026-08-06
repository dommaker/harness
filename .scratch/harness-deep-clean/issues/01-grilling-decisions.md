Title: 一次性 grilling:全套重构边界决议
Type: grilling
Status: resolved

## Question

全套自动化重构开工前,需要人工一次性确认的全部边界问题:删除判据、接口边界、studio 关系、测试策略、git 交付、版本发布、性能验收、清理范围、验收产物。

## Answer

用户已一次性答复(2026-08-07):

1. **Q1 删除判据:A** — agent 自主裁决;完整调用链/导入/结构体/常量/工具方法扫描后,无调用方且 studio 未使用的功能一律删除,连带孤立死代码一并清除。附加约束:删除前须核对 studio 是否"真实需要而尚未引入",此类功能保留。
2. **Q2 接口边界:B + 护栏** — 对外接口可大改;绝不修改 studio;research 阶段产出 studio 使用面快照作为删除护栏;最终报告附迁移说明供 studio 收尾单向适配。
3. **Q3 测试策略:A** — 过时测试可删改,最终全套 jest 必须绿。
4. **Q4 git 交付:A 变体** — 新分支 `refactor/deep-clean` 工作,只提交不 push(push 会卡住);CLAUDE.md 在途改动保留(已随基线提交 575065b)。
5. **Q5 版本发布** — 不 bump、不发布;产出改动清单/报告,用户次日验收后统一走一次 ship 流程。
6. **Q6 性能验收:A** — agent 合理判断 + 报告说明。
7. **Q7 清理范围** — 全部确认:rebuild-*.js、coverage/、temp-nonexistent-perf/、docs/ 纳入;双锁文件保留 pnpm(agent 核实后删 package-lock.json)。
8. **Q8 验收产物** — 完整重构报告置于 .scratch/ 下;用户看完报告再决定是否发布新版本。
9. **执行模式** — 答复后禁止再弹任何确认;全程后台串行执行到闭环,不许中途暂停等待指令。
