Title: 执行:types 层去反向依赖
Type: task
Status: open
Blocked by: 08

## Question

Diagnosis/ConstraintProposal 类型从 monitoring/constraint-doctor、constraint-evolver 搬入 types/(如 types/monitoring-types.ts);types/index.ts 不再 import ../monitoring、../failure(后者若已是纯类型文件则归位 types);monitoring 改从 types 导入;全仓 import 路径跟随调整;build+jest;独立提交。
