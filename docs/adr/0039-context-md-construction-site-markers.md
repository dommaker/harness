# ADR-0039: CONTEXT.md 判定面扩到标记化陈述——构造点计数标记

- 日期：2026-09-29
- 状态：已接受
- 影响版本：随下个 minor 发布（`sync-docs --check` 判定面新增一类内容漂移，CHANGELOG 标 `!`，见「影响」）
- 关联：harness#202（票下 Agent Brief 为本 ADR 的正本）；ADR-0025（本 ADR 是它的**补充而非推翻**——标记化陈述进判定面，任意散文仍不判）；ADR-0009/ADR-0025（同一套「纯判定 + 调用方组装 fs 采集」形状）

## 背景

ADR-0025 落地时明确「故意只判符号面，散文机械不可判」：CONTEXT.md 里「仓内构造点两处」这类计数陈述没有任何机制兜底，错了只能等下一次人工评审撞出来（harness#202 的三处漂移就是这么攒的：knowledge/CONTEXT.md 的「构造点两处」实为一处，退役/复活写口经 `openKnowledgeStore()` 同一解析点注入，并非独立构造点）。

但「散文不可判」不等于「散文里的每一句都不可判」——一句陈述如果**作者愿意附带机器可读标记**，它就变成了可判的声明。本 ADR 把判定面扩到这类标记化陈述，第一种落地类型是构造点计数。

## 决策

### 1. 标记语法

CONTEXT.md 的散文陈述旁附 HTML 注释形标记：

```
<!-- sync-docs:construction-sites <ClassName> = <N> -->
<!-- sync-docs:construction-sites <ClassName> = <N> include: tests -->
```

- 语义：「类 `<ClassName>` 的仓内直构造点恰为 `<N>` 处」。
- `include: tests` 把测试目录计入计数（缺省不计）。
- **无标记的散文维持现状不判**；畸形标记（缺数字/缺类名/未知选项）整条跳过——不判优于误判。
- 机制留了类型槽位（`sync-docs:<类型>`），本票只实现 `construction-sites` 一种；调用点计数、实现处数等另票再说。

### 2. 计数口径

- 只数 `new X(` **直构造**出现次数（含一层泛型实参，`new Map<string, boolean>()` 算）；工厂封装调用点（`openKnowledgeStore()` 等）不算构造点。
- 范围 = 全仓 `.ts`（排 `.d.ts`），排除口径沿用 `DEFAULT_SKIP_DIRS`（`node_modules`/`__tests__`/`dist`）；`include: tests` 时把 `__tests__` 从跳过名单放出。
- 计数口径正本是纯函数 `tallyConstructionSites(source)`（core 侧），采集侧逐文件调用后累加——check 与任何未来消费方共用同一份规则。

### 3. 判定形状仿 context-reconcile

- 纯判定住 `src/core/constraints/construction-sites.ts`：`parseConstructionSiteMarkers` / `tallyConstructionSites` / `reconcileConstructionSites({ markers, countFor })` → 漂移列表（点名类名/期望/实际）。零 fs IO。
- fs 采集住 `src/cli/commands/sync-docs/context-syncer.ts`：`createConstructionSiteCounter(projectPath)` 按口径（计/不计测试）各懒采集一次并 memo——全仓走一遍不便宜，只在某份文档真带标记时才采集。
- 漂移并入 sync-docs 既有 `contentDrift` 面：`--check` 判 fail 且 reason 点名文件与类名；`--json` 的 contentDrift 条目多带 `constructionSites` 明细；**写入模式只提示、不改文档**（数字自愈属 Out of scope——改文档里的数字是语义动作，不是机械动作）。
- 首个实战用例：`src/knowledge/CONTEXT.md` 的 FileKnowledgeStore 构造点陈述（修正为「一处」并附标记）。

## 理由

- 「散文不可判」的正确推论不是「永远靠人读」，而是「把可判的那一小片变成声明」。标记把作者意图显式化：写了标记 = 这句话接受机器对撞；没写 = 维持 ADR-0025 的人读面。
- 判定与采集分离后，标记解析/计数口径/对撞全部可用字符串夹具测（零 fs）；采集侧只测遍历与排除口径。
- 计数漂移不改文档与 ADR-0025「写入模式不改写 CONTEXT.md」同判据：散文（含其中的数字）不可机械生成。

## 影响

- **对消费方变严（release note 必提）**：升级后 `sync-docs --check` 对带标记的 CONTEXT.md 新增判定。缓冲与 ADR-0025 相同：不带标记的文档零影响（判定面只认标记），且 init 生成的消费者工作流里该步骤本就非阻断。
- **已知限度（登记，不掩盖）**：
  - 计数是**正则解析源文本**：字符串字面量/注释里的 `new X(` 字样会被计入；嵌套泛型实参（`new Map<string, Map<…>>()`）不按一层口径匹配。撞上了就按实况调标记数字或改用散文——与 ADR-0025 的导出面正则限度同一性质。
  - 绕闸路径存在——删掉标记，判定就消失。对策同 ADR-0025：票面纪律 + 统一复审，不再加机械闸。
  - 标记只钉「数量」，不钉「位置」——构造点从 A 文件挪到 B 文件，计数不变、闸不响。
- **不在本票**（票面 Out of scope）：计数漂移的自动修复；`construction-sites` 之外的标记类型；AGENTS.md 的标记支持（AGENTS.md 是生成物，散文只在 CONTEXT.md）。

## ADR-0025 的关系

补充而非推翻：ADR-0025 的「散文机械不可判」仍然成立——本 ADR 判的不是散文，是散文旁的**标记**。无标记文档的判定面与 ADR-0025 落地时逐字相同。
