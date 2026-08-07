Title: 最终架构巡检:孤立死代码/无用导入/闲置变量零残留
Type: task
Status: resolved
Blocked by: 24

## Question

对重构后的全仓做终审巡检:孤立死代码、无用导入、闲置变量零残留确认;tsc noUnusedLocals/noUnusedParameters 扫描;knip 复核;build+jest 全绿;结论记入 Answer。

## Answer

完成,三项零残留:
- tsc --noUnusedLocals --noUnusedParameters:初扫 61 处诊断,全部修复后计数 0(含测试文件)。修复分三类:无用导入移除(~28 处)、无用参数下划线化或私有场景删除、无副作用闲置局部删除/副作用调用改不捕获(release.ts pub、import.ts bigCommits、performance.ts 覆盖率调用);constraint-doctor.summary 与 output-guardrail.minQualityScore 两个只写不读私有字段连同赋值删除(公开配置项保留)。41 文件 +39/−71 行。
- knip:unused files/deps 零(工单 24 已清,本轮复核不变)。
- 孤立死代码:工单 09/10/11/12/24 已分批清除(死触发器常量、死导出、无引用桶、governance、prompt-injection 别名族、废弃脚本、auto-fix.ts、tools/core 嵌套包),本轮无新增发现。
build 无错误;jest 127 套件 2130 通过/8 skipped 全绿(与基线一致)。
