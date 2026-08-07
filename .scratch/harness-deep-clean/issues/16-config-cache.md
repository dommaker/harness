Title: 执行:config.yml 解析收敛与缓存
Type: task
Status: resolved
Blocked by: 08

## Question

ProjectConfigLoader 增加进程级 memoize;checker.ts:730/768 内联 yaml.load、sync-docs.ts 三处、hooks/bootstrap.ts、governance(已删则跳过)全部改走加载器;单次 harness check 内 config.yml 只解析一次;build+jest;独立提交。

## Answer

完成。project-config-loader 新增 loadRawProjectConfig:进程级 Map 缓存,键为 resolve 后项目路径,条目带 mtimeMs+size 指纹(文件未变直接复用,变更自动失效);stat 不可用(测试 jest.mock('fs'))时降级为每次直读不缓存。收敛 6 处内联解析:checker.ts 的 checkContextDocSync/checkDocsFreshness、sync-docs.ts 的 getRequiredContextDirs/getConfigDescription/getGovernanceInfo、hooks/bootstrap.ts 的 loadConfigAsync(原有异步双读本就丢弃结果,直接简化)。两文件 js-yaml 导入随之移除。governance 模块已删,跳过。node 实测同引用命中;jest 全绿(127 套件)。
