Title: 执行:CLI 懒加载
Type: task
Status: resolved
Blocked by: 08

## Question

bin/harness.js 改为每命令 .action 内动态 require 对应实现;--version/--help 不再加载全部命令;实测加载模块数对比写入提交信息;build+CLI 冒烟(harness --version/check --help)+jest;独立提交。

## Answer

完成。bin/harness.js 顶部对 dist/cli/commands/index 的 46 符号急切解构改为 cmd(name) 懒加载助手,全部 .action 内部按需 require;command 子命令的位置参数改名 cmdArg 避免与助手冲突。实测(require.cache 计数):harness --version 加载模块 173 → 9;命令桶本身 164 模块仅在真正执行命令体时加载。冒烟:--version / check --help / check / check --list / constraints --json / kb list / failure stats / sdd 均正常;jest 全绿。
