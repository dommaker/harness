Title: prototype:重构方案验证
Type: prototype
Status: open
Blocked by: 02, 03

## Question

基于调研结论,用一次性原型验证关键重构手法可行:目标模块拆分方式(checker/definitions/sync-docs 三大件的拆分边界)、死代码检测手段(ts-prune/knip 或手工 grep 流程)的误报控制、依赖瘦身后的构建验证路径。产出可丢弃的原型与结论文字。
