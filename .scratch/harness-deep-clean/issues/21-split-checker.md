Title: 执行:checker.ts 注册表化拆分
Type: task
Status: resolved
Blocked by: 08

## Question

每条约束抽为 core/constraints/checkers/ 下独立模块(precondition/evaluate),checker.ts 瘦身为编排层(注册表+CheckContext+CheckCache);P0 签名与返回结构冻结;既有 checker.test/checker-extra.test 全绿为验收;build+jest;独立提交。

## Answer

完成。新增 checkers/ 接缝:types.ts(ConstraintCheck{id,evaluate(env)} + CheckEnv{context,projectPath,stagedDiff,stagedDiffNames,srcScan} + contextFlag/alwaysPass 工厂)、index.ts 注册表(37 条约束,getConstraintCheck 查找,未注册默认通过保持历史 default 语义)。12 个实质检查(含 I/O/git/文档解析)各自独立文件:no-bypass-checkpoint/no-test-simplification/no-fuzzy-completion-claim/no-performative-agreement/no-excuse-patterns/no-any-type/capability-sync/no-simplification-without-approval/test-coverage/context-doc-sync/docs-freshness/yagni;纯上下文标志与恒通过类按层归组(iron-flags/guideline-flags/always-pass)——零实现深度的单行检查不强行一文件一约束,这是对工单 06"每约束一文件"的有意取舍。checker.ts 1163→560 行:checkPrecondition 巨型 switch(37 case)替换为注册表分发,工单 18 的 run 级 git memo 与 CheckCache src_scan 经 CheckEnv 注入。P0 接口 check/checkConstraints/checkConstraintsSafe/beforeExecution 签名与返回结构未动;checker.test/checker-extra 等全套 127 套件绿;harness check 冒烟正常。
