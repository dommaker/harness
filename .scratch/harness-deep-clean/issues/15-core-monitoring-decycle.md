Title: 执行:core↔monitoring 循环消除
Type: task
Status: open
Blocked by: 08

## Question

checker.ts 对 getTraceCollector 的值导入改为构造/参数注入(默认 no-op 记录器),保持 checkConstraints P0 返回结构;monitoring/constraint-evolver 对 definitions 的值导入改为类型导入+约束集参数化;constraints/registry→core 的反依赖如可低成本一并处理;build+jest;独立提交。
