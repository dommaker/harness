Title: 执行:typescript 隐式运行时依赖修复
Type: task
Status: open
Blocked by: 08

## Question

knowledge/primitives/code-structure.ts 的顶层 import * as ts 改为函数内动态 require + try/catch 降级(缺 typescript 时返回空结果并 warn);补一条降级路径测试;build+jest;独立提交。
