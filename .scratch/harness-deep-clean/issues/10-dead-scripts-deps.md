Title: 执行:废弃脚本与冗余依赖清理
Type: task
Status: resolved
Blocked by: 08

## Question

删除 scripts/release.ts(与 cli/release 重复且 AGENTS.md 声明不走本地发布);删除 bin/harness-knowledge-{capture,check,track}.js(无引用钩子模板,studio 护栏清单无此项);复核 .harness/custom-constraints.yml 空壳处置。build+jest;独立提交。
