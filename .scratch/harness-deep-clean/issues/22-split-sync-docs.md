Title: 执行:sync-docs.ts 同步器化拆分
Type: task
Status: open
Blocked by: 08

## Question

拆 cli/commands/sync-docs/{capabilities-syncer,context-syncer,agents-syncer,project-reader,preserve-block}.ts;入口编排保留;PRESERVE 语义与输出格式冻结;sync-docs 相关测试(541 行套件)全绿;build+jest+实测 sync-docs --check;独立提交。
