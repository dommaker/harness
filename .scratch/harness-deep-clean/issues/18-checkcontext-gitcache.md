Title: 执行:CheckContext 与 git 缓存
Type: task
Status: resolved
Blocked by: 08

## Question

check 流程内 git diff --cached 收敛为一次计算(CheckCache 覆盖 git 命令或 CheckContext 共享);check.ts isNewDirectory 的逐文件 git ls-tree 改批量;build+jest+实测 harness check --staged 耗时对比;独立提交。

## Answer

完成。checker 新增 run 级 memo(runCache):checkConstraints/checkConstraintsSafe 入口重置、finally 清空,4 处 git diff --cached [--name-only] 收敛为 getStagedDiff/getStagedDiffNames 两个 helper,单 run 内各命令至多执行一次;run 外直调私有检查方法不 memo,保持既有单测语义。check.ts isNewDirectory 逐文件 `git ls-tree HEAD -- dir` 改为单次批量 `git ls-tree -r --name-only HEAD` + 目录集合内存判定(顺带消除旧代码把目录拼进 shell 命令串的注入面)。实测(monkeypatch 计数,3 个 src 文件 staged):ls-tree 2 次 → 恒定 1 次,最坏情形 N 文件 N 次 → 1 次;墙钟 0.12-0.15s 持平(小 staged 集下 git fork 开销本已很小)。jest 全绿。
