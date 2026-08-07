Title: 执行:core↔monitoring 循环消除
Type: task
Status: resolved
Blocked by: 08

## Question

checker.ts 对 getTraceCollector 的值导入改为构造/参数注入(默认 no-op 记录器),保持 checkConstraints P0 返回结构;monitoring/constraint-evolver 对 definitions 的值导入改为类型导入+约束集参数化;constraints/registry→core 的反依赖如可低成本一并处理;build+jest;独立提交。

## Answer

完成。checker 新增 TraceRecorder 最小接口 + setTraceRecorder 注入(默认 no-op),check/report/bootstrap/index 四个生产入口接入真实收集器,P0 返回结构不变;evolver 构造器接受 ConstraintLookup(auto-evolve/flow/测试注入 getConstraint),不再值导入 definitions;check.test.ts mock 补 setTraceRecorder。grep 复核 core→monitoring 与 monitoring→core 值导入均归零。constraints/registry→core 反依赖按工单 06 决议保留不动(过渡产物)。与工单 14 改动交织,合并一个提交。
