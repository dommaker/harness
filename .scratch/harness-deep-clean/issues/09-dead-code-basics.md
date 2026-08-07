Title: 执行:死代码基础批(常量/死导出/无引用桶)
Type: task
Status: resolved
Blocked by: 08

## Question

删除:types/constraint.ts:33-48 的 16 个死触发器常量;死导出 checkpointValidator/core-validators 单例、createProjectConfigLoader、getPerformanceCollector/configurePerformanceCollector;两个无引用桶 src/constraints/index.ts、src/core/spec/index.ts(及其引用方改为直引)。逐项 grep 复核后删;build+jest 验证;独立提交。

## Answer

完成,见 git log 对应提交。全部候选 grep 复核零引用后删除;jest 全绿。
