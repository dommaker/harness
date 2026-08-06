Title: 执行:config.yml 解析收敛与缓存
Type: task
Status: open
Blocked by: 08

## Question

ProjectConfigLoader 增加进程级 memoize;checker.ts:730/768 内联 yaml.load、sync-docs.ts 三处、hooks/bootstrap.ts、governance(已删则跳过)全部改走加载器;单次 harness check 内 config.yml 只解析一次;build+jest;独立提交。
