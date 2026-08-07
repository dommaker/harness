Title: 执行:types 层去反向依赖
Type: task
Status: resolved
Blocked by: 08

## Question

Diagnosis/ConstraintProposal 类型从 monitoring/constraint-doctor、constraint-evolver 搬入 types/(如 types/monitoring-types.ts);types/index.ts 不再 import ../monitoring、../failure(后者若已是纯类型文件则归位 types);monitoring 改从 types 导入;全仓 import 路径跟随调整;build+jest;独立提交。

## Answer

完成。新增 types/monitoring-types.ts(Diagnosis/ConstraintProposal/ProposalReviewResult)与 types/failure.ts(ErrorType/FailureLevel/规则表);failure/types.ts 与 monitoring 两文件改为兼容再导出;types/index.ts 改为同层导入(显式再导出避免星-星歧义丢符号);全仓 import 路径跟随调整;lifecycle-runner/flow/auto-evolve/doctor-evolver 等全部改从 types 导入。types 层恢复零反向依赖。与工单 15 改动交织于同批文件,合并一个提交。
