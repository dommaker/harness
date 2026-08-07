Title: 执行:删除 governance 孤岛模块
Type: task
Status: resolved
Blocked by: 08

## Question

删除 src/governance/ 整目录及其测试;清理 src/index.ts 与 cli 中对 GovernanceExecutor 的引用(init.ts 的 --governance 选项与 GOVERNANCE_PRESETS 是独立实现,保留);knip+grep 复核无残留;build+jest;独立提交。
