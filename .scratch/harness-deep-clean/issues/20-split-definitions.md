Title: 执行:definitions.ts 按层拆分
Type: task
Status: resolved
Blocked by: 08

## Question

拆为 core/constraints/definitions/{iron-laws,guidelines,tips}.ts,definitions.ts 变薄聚合保持路径与 key:/description: 字面量格式(studio rule-scanner 契约);助手收敛只留 P0;build+jest;独立提交。

## Answer

完成。1088 行 definitions.ts 拆为 definitions/iron-laws.ts(333)/guidelines.ts(668)/tips.ts(63),definitions.ts 变 50 行薄聚合(原路径不变,P0 #8);导出面 IRON_LAWS/GUIDELINES/TIPS/getAllConstraints/findConstraintsByTrigger/getConstraint 全部保留(findConstraintsByTrigger 有 iron-laws.test.ts 与 core/constraints/index.ts 引用,不属待删别名族)。studio rule-scanner 回归核对:现文件本无 `key:` 字面量(0 处,用 `id:`),其正则无从匹配,拆分前后行为一致;harness constraints --json 的 hash 拆分前后完全相同(eedc574c…),约束计数 12/28/2 不变。jest 全绿。
