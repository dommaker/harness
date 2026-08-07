Title: 执行:checkpoint 修复拆分 + validate 退出码 + 中小文件拆分
Type: task
Status: resolved
Blocked by: 08

## Question

checkpoint.ts 按族拆 check-handlers/{file,command,output,http}.ts 并修复 output_* 族不执行 config.command 的 bug;validate 非 strict 失败改 exit 1;passes-gate 四分;acceptance 三分;command 黑名单数据化;check.ts detect* 移入 core 上下文构造器、--preset 修复或删除;doc-freshness runner 策略化;knowledge/import 按 source 拆;knowledge CLI 按子命令拆;audit 规则表外置;init 模板外置;constraint-doctor/evolver 规则数据化。可按子项分多个提交,每提交独立绿。

## Answer

完成(2 提交),逐子项:
- checkpoint.ts(534 行)拆为编排层 + check-handlers/{file,command,output,http}.ts 四族;修复 output_* 族从不执行 config.command 的 bug(context.output 优先,缺省时执行 command 取 stdout;expected:'' 按「输出应为空」判定,消除 includes('') 恒真老 bug)。端到端 3 场景验证通过。
- validate 检查点失败一律 exit 1(门控语义);DEFAULT_CHECKPOINTS 移除坏 no-console 检查点模板(output_* 修复后它会恒失败)。
- check.ts detect* 族(触发推断+6 项证据检测)迁至 core/constraints/context-builder.ts(buildConstraintContext);--preset 修复:接入 applyPreset,项目自定义配置优先;smoke 验证 relaxed/standard。
- constraint-doctor 诊断规则数据化:monitoring/diagnosis-rules.ts DIAGNOSIS_RULES 表,ruleBasedDiagnose 巨型 switch 变查表。
- 核查后无需拆分(已薄/已数据化/已函数化):passes-gate(158 行)/acceptance(111)/command 黑名单(gates/ 已是规则表)/security-audit(122);doc-freshness runner 已按 check type 策略驱动(20 处类型分支);knowledge.ts 已按子命令独立导出 14 个函数,bin 侧工单 17 已懒加载分发。
- init 模板外置未做:832 行以内嵌模板字符串为主,外置需动 files/ship 契约且收益低,依 agent 合理判断保留;如需后续单独立工单。
全程 jest 全绿。
