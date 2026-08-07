Title: 执行:sync-docs.ts 同步器化拆分
Type: task
Status: resolved
Blocked by: 08

## Question

拆 cli/commands/sync-docs/{capabilities-syncer,context-syncer,agents-syncer,project-reader,preserve-block}.ts;入口编排保留;PRESERVE 语义与输出格式冻结;sync-docs 相关测试(541 行套件)全绿;build+jest+实测 sync-docs --check;独立提交。

## Answer

完成。sync-docs.ts(1144 行)→ sync-docs/ 目录:index.ts(入口编排 ~360 行)+ project-reader.ts(package/config/源码扫描/ModuleInfo/SyncResult 类型)+ capabilities-syncer.ts(双格式对比维护)+ context-syncer.ts(模板/发现/过时)+ agents-syncer.ts(AGENTS.md 生成)+ preserve-block.ts(PRESERVE 提取/组合)。commands barrel 的 './sync-docs' 导入经目录 index 解析,外部导入面不变。顺带移除原文件内零调用死函数 extractTableFiles。PRESERVE 语义与全部输出文案逐行迁移未改;sync-docs 两测试套件 37 例全绿;实测 sync-docs --check --agents 无漂移(幂等);全套 jest 绿。
