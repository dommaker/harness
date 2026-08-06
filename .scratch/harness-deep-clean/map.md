# Wayfinder Map: harness-deep-clean

Label: wayfinder:map

## Destination

harness 仓库完成全套代码优化重构并可验收:臃肿逻辑重构完毕、大文件拆分、死代码/冗余依赖/废弃功能连同残留碎片全部清除、性能瓶颈消除,全套 jest 绿,附完整重构报告(变更清单 + 新架构说明 + studio 迁移说明),用户次日早晨验收后统一走一次 ship 流程。

## Notes

- 领域:TypeScript CLI 工具库(@dommaker/harness),无 UI 代码
- 分支:`refactor/deep-clean`,全部工作提交在此,不 push、不 bump 版本、不发布
- **本 effort 覆盖 wayfinder 默认规划模式:决议完成后直接进入执行,工单逐个串行执行,每完成一处细小优化一次独立 git 提交,全程不间断**
- 用户答复固化(一次性 grilling 结论):
  - 废弃功能由 agent 自主裁决删除,但删除前必须核对 studio 使用面快照,studio 真实需要但尚未引入的功能不可删
  - 对外接口(npm exports / bin / CLI 语法)可大改;**绝不修改 /root/projects/studio**,以 studio 使用面快照为删除护栏
  - 过时测试可删改,但最终全套 jest 必须绿
  - 双锁文件:保留 pnpm-lock.yaml(经核实后删 package-lock.json)
  - 性能验收:agent 合理判断 + 报告说明
  - 清理范围:根目录 rebuild-*.js、coverage/、temp-nonexistent-perf/、docs/ 均在列
- 技能链:research → prototype → task → codebase-design → to-spec → triage → 逐个执行 → improve-codebase-architecture 终审
- 终审额外专项:孤立死代码、无用导入、闲置变量零残留

## Decisions so far

- [一次性 grilling:全套重构边界决议](issues/01-grilling-decisions.md) — 删除判据、接口边界、测试策略、git 交付、验收形式全部锁定(见该工单 Answer)

## Not yet specified

- 具体重构工单清单(triage 之后才逐个毕业为 issues/09+)
- 最终架构巡检工单(待执行工单全部闭环后创建)

## Out of scope

- 修改 /root/projects/studio 仓库任何文件(其并行重构中,冲突不可控;以迁移说明文档单向交付)
- npm publish / 版本 bump / CHANGELOG 发布流程(用户验收后统一 ship)
- git push 到 origin(用户环境 push 会卡住;留本地待验收)
