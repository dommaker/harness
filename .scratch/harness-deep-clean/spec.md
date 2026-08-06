# Spec: harness 全套代码优化重构(deep-clean)

Status: ready-for-agent
依据:工单01(决议)、02(调研)、03(护栏)、04(原型)、06(架构设计)

## Problem Statement

harness 是个人半成品工具项目(33K 行 TS、22 模块、25 CLI 命令):三大件 God 文件(checker 1169 / definitions 1126 / sync-docs 1188 行)、10 个孤岛模块、死常量/死导出/双发布流水线/零使用依赖、core↔monitoring 循环依赖、types 分层倒挂、单次 check 重复跑 git diff×4 与 config.yml 解析×6、CLI 急切加载 164 模块、typescript 隐式运行时依赖 bug、dogfooding 配置(no-console checkpoint)三因必败。代码臃肿、性能浪费、维护困难度差。

## Solution

一次性深度重构:删除全部经调用链核验的死代码与废弃功能(以 studio 使用面快照为护栏)、拆分全部大文件为深模块、建立严格单向分层、消除循环依赖与重复 IO、CLI 懒加载、修复 dogfooding 配置。最终全套 jest 绿,产出重构报告供用户验收后统一 ship。

## User Stories

1. 作为 harness 维护者,我想要 checker 拆分后的约束检查器注册表,以便新增约束只加一个文件而不动 God class
2. 作为 harness 维护者,我想要 definitions 按层拆分,以便 IRON_LAWS/GUIDELINES/TIPS 各自独立演进
3. 作为 harness 维护者,我想要 sync-docs 三个同步器独立,以便修 AGENTS.md 逻辑不碰 CAPABILITIES 逻辑
4. 作为 harness 使用者(studio),我想要全部 P0/P1 符号与生成物契约不变,以便 studio 零适配继续工作
5. 作为 CLI 用户,我想要 harness --version 毫秒级响应,以便不被 164 模块急切加载拖累
6. 作为 CI 流水线,我想要单次 harness check 内 git diff 只跑一次,以便缩短检查耗时
7. 作为包消费者,我想要 require @dommaker/harness 不强制安装 typescript,以便运行时不崩溃
8. 作为仓库贡献者,我想要 pre-commit 钩子不再误报 no-console 失败,以便提交体验正常
9. 作为仓库贡献者,我想要 harness validate 失败时真正返回非零退出码,以便门禁生效
10. 作为维护者,我想要死代码(16 触发器常量/死导出/无引用桶/双发布流水线/废弃钩子脚本)零残留,以便降低认知负担
11. 作为维护者,我想要 types 层零 import,以便类型层不造成分层倒挂
12. 作为维护者,我想要 core↔monitoring 循环消除,以便模块可独立测试
13. 作为维护者,我想要会话挖掘只有一套实现,以便修聚类算法只改一处
14. 作为维护者,我想要文件遍历/CAPABILITIES 解析只有一个共享实现,以便行为一致
15. 作为维护者,我想要 trace-analyzer 与 performance-analyzer 共享分析基座,以便消除镜像代码
16. 作为用户,我想要 check --preset 要么生效要么消失,以便不被虚假选项误导
17. 作为验收者,我想要一份完整重构报告,以便次日早晨一次性审核后统一 ship

## Implementation Decisions

1. **分层冻结**:`types(零 import)→ utils → core → 领域层(knowledge/context/monitoring/gates/failure/hooks/safety/agents/architecture/tools/verification/evolution/dashboard/llm/presets/sdd/spec/user-model)→ cli`,任何新 import 不得反向
2. **循环消除**:checker 的 trace 记录改注入/回调解耦;evolver 对 definitions 改类型导入+参数传入;types 的 Diagnosis/ConstraintProposal 归位 types 层
3. **checker 注册表化**:每条约束 = 独立检查器模块(含 precondition/evaluate),编排层持注册表 + CheckContext(git diff/config/CAPABILITIES 单次计算)+ 真正的 CheckCache
4. **definitions 按层拆分**:三文件 + 薄聚合保持原路径(studio rule-scanner 正则契约);别名族删除,IronLawContext 保留
5. **sync-docs 同步器化**:capabilities/context/agents 三同步器 + ProjectReader(config 单读)+ preserve-block 工具;输出格式冻结
6. **CLI 懒加载**:bin 每命令 action 内动态 require
7. **配置缓存**:ProjectConfigLoader 进程级 memoize,全仓六处独立解析收敛
8. **typescript 隐式依赖**:动态 require + 功能降级
9. **删除清单**(护栏核对通过):src/governance/、scripts/release.ts、bin/harness-knowledge-*.js、prompt-injection.ts、16 死触发器常量、死导出(checkpointValidator/createProjectConfigLoader/getPerformanceCollector)、两个无引用桶(constraints/index、core/spec/index)、checker/definitions 兼容别名族、.harness/custom-constraints.yml 空壳
10. **合并**:update-user-model + analyze-sessions → session-mining;trace-analyzer + performance-analyzer → analyzer-base
11. **拆分**:init(模板外置+预设统一)、knowledge CLI(按子命令)、audit(规则表外置)、passes-gate(四分)、checkpoint(按族+修 output_* bug)、constraint-doctor/evolver(规则数据化)、acceptance(三分)、command gate(黑名单数据化)、check(detect* 移出)、doc-freshness runner(策略化)、knowledge/import(按 source)
12. **dogfooding 修复**:no-console checkpoint 重写或删除;validate 失败 exit 1;pre-commit 去 set -e 冲突、build/test 移出 commit 路径;config.yml version 戳更新
13. **src/tools/core 嵌套 node_modules**:核实 YAML definitions 是否引用 core 常量后,删除嵌套 node_modules/package.json(13MB 运行时产物进 npm 包源码树不合理的部分)

## Testing Decisions

- 好测试 = 只测外部行为:全部现有 128 套件为回归基线,重构不改测试意图;拆分产生的新模块沿用既有测试(移动而非重写)
- 拆分后的检查器注册表:经 constraintChecker.checkConstraints 这一最高接缝测试(既有 checker.test/checker-extra.test 直接复用)
- checkpoint output_* 修复:新增针对 config.command 真实执行的用例(仿 checkpoint.test.ts 既有模式)
- 删除项验证:knip 复扫 + build + jest 三连验证;每个删除提交独立可回退
- 性能项:前后对比说明写入报告(Q6-A 裁决:合理判断+说明,不强制 benchmark)

## Out of Scope

- studio 仓库任何改动;npm publish/版本 bump/CHANGELOG;git push
- 转型文档中的新功能(知识闭环新能力、LLMAdapter 完整实现、Dashboard UI 数据扩展等)——只对齐结构
- 约束语义变更(约束本身的内容/级别不动,仅结构重组)

## Further Notes

- 执行节奏:每个细小优化一次独立 git 提交;每提交后 jest 必须绿;pre-commit 钩子自身的问题在中途修复后生效
- 验收:重构报告落 .scratch/harness-deep-clean/REPORT.md
