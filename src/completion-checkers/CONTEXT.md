# completion-checkers/

## 职责
WU 收尾软观测三纯判定函数（T7-E1，studio#160）：tdd-chain 引用链 / phase-format subject 结构 / contract-presence 契约在场。纯函数，不碰文件系统与 git，commits 由调用方（studio completion-gates 第四段守卫，T7-E2）供给。

## 核心导出
- `verifyTddChain(commits, config)`（`tdd-chain.ts`）——实现 commit 须带 trailer `Tested-By: <sha>`（`TESTED_BY_RE` 写死）；被引 sha 须在本提交集内、位置在前、文件清单命中 test_globs；`Tests: none`（`TESTS_NONE_RE`）→ waiver；纯测试/纯非代码 commit 天然免检
- `verifyPhaseFormat(commits, config)`（`phase-format.ts`）——非 merge commit subject 命中 `PHASE_SUBJECT_RE`（`^phase\([a-z0-9-]+\):\s+\S`，写死）；merge commit 记违规（`CommitInput.isMerge` 优先，缺省 subject 启发式）
- `verifyContractPresence(type, context, config)`（`contract-presence.ts`）——yml contracts 清单查表，无表项 = skip；类型→判定方法映射是代码不是配置（review → `context.reviewReport` 在场）；清单内无判定方法 = violation（配置与代码失配）
- `CompletionCheckersConfig`（`types.ts`）——enabled 总开关 / checkers 各开关 / testGlobs / noncodeGlobs / contracts；协议格式不进配置
- `classifyCommitFiles` / `resolveGlobs`（`classify.ts`）——文件分类，tdd-chain 与 phase-format 共享口径
- `matchGlob` / `matchAnyGlob` / `DEFAULT_TEST_GLOBS` / `DEFAULT_NONCODE_GLOBS`（`glob-match.ts`）——轻量 glob 匹配（`**`/`*`/`?`）

## 依赖关系
- 无内部依赖（纯函数模块，自包含）

## 约定
- 与 ConstraintCheck 闭环注册表无关：直接 export，禁止注册进 checkers/index.ts
- verdict 四态：pass / violation / waiver（豁免放行，commit 级）/ skip（不适用，不记台账）
- 新增契约类型 = `CONTRACT_JUDGMENTS` 加一条映射 + 测试
- 协议格式（Tested-By、Tests: none、phase 结构）写死为机制本体，不得配置化

## 注意事项
- commits 输入有序（base..HEAD 升序），位置判定比索引不比时间戳
- Tested-By 引用支持 7-40 位 sha 前缀匹配
