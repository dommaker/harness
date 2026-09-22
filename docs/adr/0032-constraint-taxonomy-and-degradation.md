# ADR-0032: 约束四分法与退化治理——只有"能力兜底"会退化，退休收口 studio 审卡

- 日期：2026-09-22
- 状态：已接受
- 关联：wayfinder 地图 `/root/projects/docs/wayfinder/harness-repositioning/`（票 03 分类法定案、票 05 退休流程设计、票 02 断点清单）；ADR-0001（"退役需人确认"语义保留并强化）；ADR-0029（severity 显式化是本次级别错配修正的机制基础）

## 背景

旧分类"安全底线（永不过期）vs 质量约束（会退化）"二分法在边界案例上失效：`docs_freshness`/`capability_sync` 这类治理约束两边都不像，且二分没有给出判定标准。票 03 拷问还发现两个级别错配：`no_hardcoded_credentials` 是安全底线却配 warning 级不阻断，`docs_freshness` 是会退化的兜底却配 error 级。退休侧，票 02 实测链路前两步（诊断→确认→落盘+沉淀）是通的，断在跟进面，共 6 个断点（知识库分叉、向量同步无兜底、AGENTS.md 手写条文无人清、CLI 不 commit、回滚残留知识条目、裸 disable 吞 retire）。

## 决策

1. **约束四分法**，判定标准一句话：这条约束防的是"外部风险"、"偷懒撒谎"、"做不到"，还是"体系自身"？
   - **① 安全底线**：防外部风险（泄密、危险命令、越权写、网络外发）。永不过期，应是阻断级。现有：`CommandGate`、`no_hardcoded_credentials`、`SecurityGate`、`public_repo_sanitization`（studio 侧文本）。
   - **② 诚信纪律**：防偷懒撒谎（不验证就声称完成、删难写的测试）。永不过期——模型变强不变老实。现有：`no_completion_without_verification`、`no_test_simplification`。
   - **③ 能力兜底**：防"做不到/忘了"（文档同步、格式规范）。**会退化**，模型强了或工具自动化了就退休成知识。现有：`docs_freshness`、`capability_sync`、`context_doc_sync`。
   - **④ 元约束**：保护约束体系自身（如治理段在场守护）。生命周期跟 harness 走，不跟模型能力走。现有：`governance_presence`。
2. **只有③会退化**：①②永不过期，④跟 harness 走。安全底线类零拦截是好事，永不进退休候选。
3. **两个级别错配修正**：`no_hardcoded_credentials` 升阻断级（票 08 P0-1）；`docs_freshness` 降警告级或进退化观察名单。
4. **退化判定（退休诊断的口径）**：退休诊断**只对③能力兜底类启用**；样本门槛维持 ≥50；零拦截不直接候选退休，先进**观察名单**挂一个季度，人再决定；每季度人工看一次约束总盘面（用现有 report，不建新机制）。
5. **退休流程收口 studio 审卡**：studio 跑诊断 → 退休候选变审卡（文案禁黑话，见 ADR-0033）→ 人 approve → studio 调 harness 执行退休 + 自动 commit + 触发向量同步。CLI 交互确认保留为裸项目备用通道（ADR-0001 决策 2 语义不变）。
6. **六个断点的修复方向**：
   1. 知识库目录分叉 → 由 ADR-0034 收编（唯一正本 `~/.studio/knowledge`），退休沉淀必须写进正本库；
   2. 向量同步无兜底 → 退休事件由 studio 触发同步，不等顺风车；
   3. AGENTS.md 手写条文无人清 → 退休审卡自动列出涉及的手写段，approve 时一并生成清理动作；
   4. CLI 不 commit → 收口 studio 后自然解决（studio applier 已带 commit）；
   5. 回滚残留知识条目 → 不改历史：复活时写新条目 `constraint-reactivated-<id>`，旧沉淀保留；
   6. 裸 disable 吞退休 → harness 修：already_retired 判定识别 retired 墓碑，disable 与 retire 分开。

## 否决的备选

- **自动退休（工具判定零拦截直接退）**：被否决。退休保持人确认（ADR-0001 语义保留），工具只摆数据——"零拦截"到底是"没用"还是"大家本来就做对"需要人判，观察名单就是把这件事缓一个季度再交给人，而不是交给阈值。
- **退休诊断对全类启用**：被否决。①安全底线零拦截是期望状态（没人试图泄密不等于防线没用），②诚信纪律同理；全类启用会把最不能退的约束刷成退休候选。④元约束跟 harness 走，也不适用能力退化口径。

## 影响

- 现有 7 条内置约束完成归类；级别错配两项进入安全补齐清单（票 08 P0）与退化观察名单。
- 退休主通道从 CLI 交互迁到 studio 审卡，CLI 通道降为裸项目备用；harness 侧需要修 already_retired 幂等判定（断点 6）。
- 知识沉淀语义扩展：新增 `constraint-reactivated-<id>` 条目类型（回滚时写），旧 `constraint-retired-<id>` 条目不再改动。
- 实施另起 effort，本 ADR 只定案方向与口径。
