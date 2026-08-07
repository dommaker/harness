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
- **已锁定的事实**(调研所得):
  - jest 基线:128 套件 / 2167 通过 / 8 skipped / 0 失败,全绿(重构全程保持)
  - 双锁裁决:CI(4 workflow)与 publish 均用 npm ci → 保留 package-lock.json,已删 pnpm-lock.yaml(commit 76a9b66)
  - `docs/2026-05-01-harness-transformation.md`(3271 行)是作者的"从约束引擎到知识引擎"转型蓝图,含目标包结构/约束分层/模块改造表 → 本次重构的**架构北极星**;但属功能转型规划,本次只对齐结构、不实现新功能
  - 仓库自身 dogfooding:.harness/checkpoints.yml 的 no-console checkpoint 有 bug(grep src/ 全量扫描,CLI 产品必然有合法 console 输出却判失败),pre-commit 每次跑全量 build+test —— 均属修复目标
  - CI 门槛:coverage ≥79%,master 受保护走 PR(但本次按用户决议不 push,只本地提交)

## Decisions so far

- [一次性 grilling:全套重构边界决议](issues/01-grilling-decisions.md) — 删除判据、接口边界、测试策略、git 交付、验收形式全部锁定(见该工单 Answer)
- [task:前置准备](issues/05-task-prep.md) — jest 基线全绿;双锁反向裁决保留 npm;rebuild-*.js 已删
- [research:studio 使用面快照](issues/03-research-studio-usage.md) — 50 条护栏清单(P0 不可破坏);最脆弱:知识引擎构造器、version 契约、sync-docs PRESERVE 语义
- [research:源码全景调研](issues/02-research-codebase.md) — 10 孤岛模块(仅 governance 可删)、三大件病灶、zod/死常量/双发布流水线、core↔monitoring 循环、typescript 隐式依赖 bug、no-console checkpoint 根因
- [prototype:重构方案验证](issues/04-prototype-approach.md) — knip+人工核对流程固化;依赖瘦身实测通过(d5b4bac);三大件拆分边界锁定
- [codebase-design:目标模块架构规划](issues/06-codebase-design.md) — 单向分层 types→utils→core→领域层→cli;三大件注册表化/按层拆分/同步器化;删除清单与 dogfooding 修复设计锁定
- [to-spec:重构规格](issues/07-to-spec.md) — spec.md 发布(ready-for-agent):17 用户故事/13 实现决议
- [执行:死代码基础批](issues/09-dead-code-basics.md) — 16 死常量/3 死导出/2 无引用桶删除,jest 全绿
- [执行:废弃脚本与冗余依赖清理](issues/10-dead-scripts-deps.md) — 废弃发布脚本与无引用知识钩子删除
- [执行:删除 governance 孤岛模块](issues/11-delete-governance.md) — governance 整模块删除
- [执行:删除 prompt-injection 与兼容别名族](issues/12-delete-prompt-injection-aliases.md) — prompt-injection 与 IronLaw 别名族删除
- [执行:typescript 隐式运行时依赖修复](issues/13-typescript-lazy.md) — 改为懒加载降级
- [执行:types 层去反向依赖](issues/14-types-layer-fix.md) — Diagnosis/Proposal/failure 类型归位 types 层,types 零反向依赖
- [执行:core↔monitoring 循环消除](issues/15-core-monitoring-decycle.md) — trace 记录器注入化 + evolver 约束集参数化,双向值导入归零
- [执行:config.yml 解析收敛与缓存](issues/16-config-cache.md) — loadRawProjectConfig 进程级 memoize(mtime+size 指纹),6 处内联解析收敛
- [执行:CLI 懒加载](issues/17-cli-lazy-load.md) — bin 命令实现 .action 内按需 require,--version 加载模块 173→9
- [执行:CheckContext 与 git 缓存](issues/18-checkcontext-gitcache.md) — run 级 memo 收敛 4 处 git diff;ls-tree 逐文件→批量(2/N 次→1 次)
- [执行:重复逻辑收敛](issues/19-shared-utils-dedup.md) — file-walk/capabilities-parser/session-mining/analyzer-base 四个共享层(4 提交)
- [执行:definitions.ts 按层拆分](issues/20-split-definitions.md) — 1088 行拆为三层层文件+50 行薄聚合,约束 hash 不变
- [执行:checker.ts 注册表化拆分](issues/21-split-checker.md) — 37 约束抽入 checkers/ 注册表,checker 1163→560 行,P0 冻结
- [执行:sync-docs.ts 同步器化拆分](issues/22-split-sync-docs.md) — 1144 行拆为 5 同步器+入口编排,PRESERVE 语义冻结
- [执行:checkpoint 修复拆分+validate 退出码+中小文件拆分](issues/23-fixpoint-split.md) — check-handlers 四族+output_* bug 修复+门控 exit 1+context-builder+诊断规则数据化
- [执行:dogfooding 修复 + knip 终扫](issues/24-dogfood-final-sweep.md) — 钩子/checkpoints/version 戳修复,tools/core 嵌套包清除,knip 清零

## Not yet specified

(执行工单 09-24 全部闭环;最终架构巡检工单 25 已创建)

## Out of scope

- 修改 /root/projects/studio 仓库任何文件(其并行重构中,冲突不可控;以迁移说明文档单向交付)
- npm publish / 版本 bump / CHANGELOG 发布流程(用户验收后统一 ship)
- git push 到 origin(用户环境 push 会卡住;留本地待验收)
