Title: 执行:checker.ts 注册表化拆分
Type: task
Status: open
Blocked by: 08

## Question

每条约束抽为 core/constraints/checkers/ 下独立模块(precondition/evaluate),checker.ts 瘦身为编排层(注册表+CheckContext+CheckCache);P0 签名与返回结构冻结;既有 checker.test/checker-extra.test 全绿为验收;build+jest;独立提交。
