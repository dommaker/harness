Title: 执行:CLI 懒加载
Type: task
Status: open
Blocked by: 08

## Question

bin/harness.js 改为每命令 .action 内动态 require 对应实现;--version/--help 不再加载全部命令;实测加载模块数对比写入提交信息;build+CLI 冒烟(harness --version/check --help)+jest;独立提交。
