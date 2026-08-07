Title: 执行:重复逻辑收敛(文件遍历/CAPABILITIES/会话挖掘/分析器)
Type: task
Status: resolved
Blocked by: 08

## Question

findTsFiles×2+findSourceFiles 收敛为 utils/file-walk 单一实现;CAPABILITIES.md 解析×2 收敛共享模块;update-user-model 与 analyze-sessions 的会话挖掘合并为 cli/session-mining/;trace-analyzer 与 performance-analyzer 抽 analyzer-base;build+jest;独立提交(如过大可按子项分 2-3 个提交)。

## Answer

完成,按子项 4 个提交:
- A: utils/file-walk(walkFiles/findTsSourceFiles)收敛 5 处递归遍历(sync-docs/cross-project-checker/checker.findSourceFiles/spec-baseline-check/doc-freshness-check),spec-baseline-check 顺带从每关键词一遍遍历改为一次遍历复用。
- B: core/constraints/capabilities-parser(parseCapabilitiesEntries/readCapabilitiesEntries)收敛 checker 与 sync-docs 两份 CAPABILITIES.md 表格正则;secondColumnOnly 选项保持 checker 历史严格语义,目录条目正则与 studio PR #44 防误判注释原样迁移。
- C: cli/session-mining/(transcript/corrections/text/index)收敛两命令的 transcript .jsonl 解析、纠正模式表(合并超集取较宽窗口)、分词/停用词/Jaccard/stripCodeBlocks;两命令冒烟正常(update-user-model --dry-run 处理 24 会话)。
- D: monitoring/analyzer-base(groupByKey/timeRangeOf/findMostCommon/calcAverage/calcPercentile/splitByTime/write/readSummaryJson/MIN_TREND_SAMPLES)收敛 trace-analyzer 与 performance-analyzer 镜像同构部分;两类公开接口(P1)不变。
全程 jest 全绿。
