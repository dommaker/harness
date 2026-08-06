Title: 执行:删除 prompt-injection 与兼容别名族
Type: task
Status: open
Blocked by: 08

## Question

删除 src/core/constraints/prompt-injection.ts(@deprecated 已迁 studio-shared;快照确认 studio 未引用);删除 checker.ts:1135-1169 别名(IronLawChecker/checkIronLaw/checkAllIronLaws/ironLawChecker)与 definitions.ts:1068-1126 别名(getAllLaws/findLawsByTrigger/getLaw/filterLawsBySeverity)——保留 IronLawContext 类型与 P0 的 getAllConstraints 族;同步删/改相关测试;build+jest;独立提交。
