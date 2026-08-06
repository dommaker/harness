Title: 执行:重复逻辑收敛(文件遍历/CAPABILITIES/会话挖掘/分析器)
Type: task
Status: open
Blocked by: 08

## Question

findTsFiles×2+findSourceFiles 收敛为 utils/file-walk 单一实现;CAPABILITIES.md 解析×2 收敛共享模块;update-user-model 与 analyze-sessions 的会话挖掘合并为 cli/session-mining/;trace-analyzer 与 performance-analyzer 抽 analyzer-base;build+jest;独立提交(如过大可按子项分 2-3 个提交)。
