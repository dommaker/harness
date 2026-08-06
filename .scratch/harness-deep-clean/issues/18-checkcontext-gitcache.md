Title: 执行:CheckContext 与 git 缓存
Type: task
Status: open
Blocked by: 08

## Question

check 流程内 git diff --cached 收敛为一次计算(CheckCache 覆盖 git 命令或 CheckContext 共享);check.ts isNewDirectory 的逐文件 git ls-tree 改批量;build+jest+实测 harness check --staged 耗时对比;独立提交。
