Title: prototype:重构方案验证
Type: prototype
Status: resolved
Blocked by: 02, 03

## Question

基于调研结论,用一次性原型验证关键重构手法可行:目标模块拆分方式(checker/definitions/sync-docs 三大件的拆分边界)、死代码检测手段(ts-prune/knip 或手工 grep 流程)的误报控制、依赖瘦身后的构建验证路径。产出可丢弃的原型与结论文字。

## Answer

原型实验完成,三个问题全部验证:

1. **死代码检测手段**:knip 可用(compact reporter),但必须人工核对:7 个 unused files 中 templates/node-api/src/index.ts 是模板内容(误报)、src/constraints/index.ts 与 core/spec/index.ts 是确认可删的无引用桶、default-adapter.ts 经 barrel 导出是公共 API。误报率 ~15%,核对依据 = src/index.ts 导出面 + studio 护栏清单。流程固化:knip 出单 → 逐条 grep 交叉验证 → 比对护栏清单 → 删除。
2. **依赖瘦身验证路径**:实测删除 zod + @types/glob(commit d5b4bac)→ npm run build → jest 128/128 全绿。验证回路:build + 全量 jest(30s,可接受)。
3. **三大件拆分边界**(结合调研报告):
   - checker.ts:约束定义与执行分离,每条约束独立 checker 函数 + 注册表,编排层只留缓存/分发;P0 签名 constraintChecker.checkConstraints 保持
   - definitions.ts:按层拆 iron-laws/guidelines/tips 三文件,助手收敛;studio rule-scanner 正则解析 key:/description: 字面量,拆分后字面量格式不可变(P0 #8)
   - sync-docs.ts:按产物拆 capabilities/context/agents 三个同步器 + 共享 ProjectReader;PRESERVE 语义是 P0 #32,输出格式冻结
