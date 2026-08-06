Title: 执行:checkpoint 修复拆分 + validate 退出码 + 中小文件拆分
Type: task
Status: open
Blocked by: 08

## Question

checkpoint.ts 按族拆 check-handlers/{file,command,output,http}.ts 并修复 output_* 族不执行 config.command 的 bug;validate 非 strict 失败改 exit 1;passes-gate 四分;acceptance 三分;command 黑名单数据化;check.ts detect* 移入 core 上下文构造器、--preset 修复或删除;doc-freshness runner 策略化;knowledge/import 按 source 拆;knowledge CLI 按子命令拆;audit 规则表外置;init 模板外置;constraint-doctor/evolver 规则数据化。可按子项分多个提交,每提交独立绿。
