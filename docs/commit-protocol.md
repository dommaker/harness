# harness 提交协议

harness 正式收编的提交协议，由 completion-checkers（`src/completion-checkers/`）机器执法。
协议格式**写死为机制本体、不进配置**（既定决策：模块只配开关/glob/契约类型清单）；
本文档是协议语义的权威说明，判定实现的正本是 checker 代码。

## 三件套

### 1. phase subject 结构（phase-format）

- 提交集（base..HEAD）内**全部非 merge commit** 的 subject 必须命中：

  ```
  ^phase\([a-z0-9-]+\):\s+\S
  ```

  即 `phase(<slug>): <描述>`，slug 为小写字母/数字/连字符。示例：`phase(p1-7): 命中留痕走 traces 通道`。
- 阶段名不维护词表、不查合法性，只验结构。
- **merge commit 出现即记违规**（判定优先 `CommitInput.isMerge` 显式字段，缺省按 `^Merge\s` subject 启发式）。
- subject 结构要求覆盖全部非 merge commit，无文件分类免检。

### 2. Tested-By 引用链（tdd-chain）

- **实现 commit**（文件清单既非纯测试也非纯非代码）必须在 body 带 trailer：

  ```
  Tested-By: <sha>
  ```

  正则 `^Tested-By:\s*([0-9a-f]{7,40})\s*$`（多行模式），sha 支持 7–40 位前缀匹配。
- 被引 sha 须同时满足三条，缺一记 violation（伪造引用不放行）：
  1. 在本提交集内（base..HEAD）；
  2. 序列位置在本 commit **之前**（commits 输入有序升序，比位置不比时间戳）；
  3. 其文件清单命中 `testGlobs`（即被引的是测试 commit）。
- **天然免检**：纯测试 commit 与纯非代码 commit（文件分类口径见 `classify.ts`，glob 可配）。

### 3. Tests: none 豁免（tdd-chain）

- 实现 commit 在 body 声明 `Tests: none`（正则 `^Tests:\s*none\s*$`）→ 记 **waiver**
  （豁免放行，commit 级记台账），替代 Tested-By 要求。
- 豁免是显式声明，不是缺省；缺 Tested-By 且未声明豁免 = violation。

## verdict 口径

四态：`pass` / `violation` / `waiver`（豁免放行）/ `skip`（不适用或免检，不记台账）。
checker 级 verdict：任一 commit `violation` → checker 整体 `violation`，否则 `pass`。
