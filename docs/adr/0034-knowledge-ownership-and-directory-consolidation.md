# ADR-0034: 知识归属与目录收编——家具归 harness、货归 studio、唯一正本 ~/.studio/knowledge

- 日期：2026-09-22
- 状态：已接受
- 关联：wayfinder 地图 `/root/projects/docs/wayfinder/harness-repositioning/`（锁定前提"知识分工"，票 06 环节归属定案、票 02 断点 1）；ADR-0029（退休落点只剩 config.yml + retired 元数据 + KnowledgeStore，知识写口路径由本 ADR 收敛）；ADR-0031（分工总尺）、ADR-0032（退休沉淀必须写进正本库）

## 背景

知识链路现状：生产（studio 7 类 producer + 会话提炼 + 蒸馏）→ 人审（studio review-adapter）→ 存（harness FileKnowledgeStore）→ 同步（向量库，mcp-local-rag 消费）→ 消费（prompt 注入 / query_documents）。痛点有三个：每个环节归谁没有明说，出问题不知道找谁；**两个知识目录物理分叉**——harness 缺省库 `~/.harness/knowledge`、studio 正本 `~/.studio/knowledge`，当前仅靠"旧目录有数据则沿用"的兼容逻辑维持同一物理目录（票 02 断点 1 实测：全新环境退休沉淀会落进 `~/.harness/knowledge`，studio 永远看不到）；harness 里的 KnowledgeInjector 在做 prompt 注入编排，属消费侧职责却长在机制侧。

## 决策

1. **知识分工（家具与货）**：知识的存储/索引/查询代码（家具）和质量标准（入库打分、分类法、生命周期规则）归 harness；知识数据（货）和生产/人审/同步触发/消费编排永远归 studio，存 `~/.studio/knowledge`，不回填 harness。
2. **环节归属表**：
   | 环节 | 归谁 |
   |---|---|
   | 生产（7 类 producer、会话提炼、蒸馏） | studio |
   | 人审 | studio 审卡中心 |
   | 存储/索引/查询（家具） | harness |
   | 质量标准（入库打分、分类法、生命周期规则） | harness |
   | 向量库同步触发 | studio |
   | 消费（prompt 注入、检索挑哪几条） | studio |
3. **贴错位置的挪正**：harness 的 `KnowledgeInjector`（做 prompt 注入，属消费编排）长期挪去 studio；"知识 → skill/约束候选判定"留在 harness（那是标准），提案落 studio 审卡（与 ADR-0033 的升级通道同一界面）。
4. **目录收编**：studio 场景唯一正本 `~/.studio/knowledge`；仓内 `.harness/knowledge/` 改名或并进 docs（摘掉"知识库"帽子）；`~/.harness/knowledge` 对 studio 停用——它只是裸 CLI 项目的缺省目录，双目录分叉是要收拾的历史包袱，不是设计。
5. **两条独立检索通道**（链路图必须画成两支，不串成一条）：
   - **频道注入**：agent 干活时 `injectContext` → harness 文件查询，**不经 mcp-local-rag**；
   - **语义检索**：mcp-local-rag 服务 studio 界面/API 语义搜索 + 本地 CLI 会话 `query_documents`。
6. **mcp-local-rag 归属**：它是"语义检索"格子的现任工具，同步触发和存活保障归 studio 编排；**harness 不认识它**（机制侧不出现对它的依赖）。
7. **知识质量盘**：三层度量（入库打分/被引用消费次数/健康度）现状散着无统一盘面——建一个知识质量盘，人按季度随约束总盘面（ADR-0032）一起看。

## 否决的备选

- **知识引擎整体搬去 studio**：被否决。存储/检索家具是通用机制，搬进 studio 后裸 CLI 项目和其他应用得各造一套；且 harness 自身机制要写库（退休沉淀 `constraint-retired-<id>` 等，见 ADR-0029/0032），家具搬走会让机制侧反向依赖编排侧。正确切分是家具与货分离，不是整体搬家。
- **维持双目录（`~/.harness/knowledge` 与 `~/.studio/knowledge` 并存）**：被否决。票 02 实测两个库物理不通，当前的"通"只是历史数据巧合下的兼容路径；新环境即断，退休沉淀会写进 studio 永远看不到的目录。分叉没有设计收益，只有事故面。

## 影响

- harness 侧：`resolveKnowledgeBaseDir` 的兼容沿用逻辑随收编退役；KnowledgeInjector 标记长期迁移方向（挪 studio）；`.harness/knowledge/` 改名/并 docs 属本仓后续改动。
- studio 侧承接：唯一正本 `~/.studio/knowledge` 不变；退休/入库事件的向量同步触发、mcp-local-rag 存活保障、知识质量盘，均为 studio 编排层改动。
- mcp-local-rag 仓定位明确：studio 编排侧工具，本 ADR 不含其本体改动。
- 实施另起 effort，本 ADR 只定归属与收编方向。
