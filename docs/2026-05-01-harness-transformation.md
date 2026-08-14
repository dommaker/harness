# Harness 转型规划：从约束引擎到知识引擎

> 创建日期：2026-05-01
> 状态：规划中
> 前置文档：agent-studio/docs/2026-05-01-agent-native-transformation.md

---

## 目录

- **一、核心判断** — 两类约束的本质区别、Harness 新定位
- **二、知识闭环：设计的唯一主线** — 五阶段飞轮、子系统映射、知识流动全景
- **三、知识从哪来（① 来）** — 冷启动导入、ARCHIVE 提取、团队共建
- **四、知识怎么存（② 存）** — 三维正交体系、五层存储、渐进式索引
- **五、知识怎么用（③ 用）** — 查询预算、Token 流水线、提示词组装、会话压缩
- **六、怎么保证用对了（④ 对）** — 三层安全护栏、Sandbox、验证循环
- **七、怎么越用越好（⑤ 好）** — 成熟度升降、引用追踪、知识 Lint
- **八、怎么看得见** — Dashboard、反馈环、可观测性
- **九、约束系统的去向** — 永久保留 vs 逐步退化 vs 转型知识约束
- **十、架构改造** — 三包合一、类型系统、HarnessREPL
- **十一、实施路线** — 6 个 Phase（10-13 周）
- **十二、Studio 适配**
  - 12.1-12.8 — 依赖变更、API 端点、前端页面、Studio 自身优化
  - 12.9 — 系统能力 MCP 化：UI 和 Agent 共享同一套后端
  - 12.10 — 会议系统改造 + Agent 统一调度（三层架构、决策→执行→验证→回写）
  - 12.11 — LLM 配置体系：UI 配置 → 安全存储 → 分层下发
  - 12.12 — 知识进化引擎：闭环的最后一步（微观/中观/宏观三层进化）
- **十三、向后兼容** — API 兼容、渐进式迁移
- **十四、设计原则** — 核心原则、架构抉择、R.E.S.T 目标

---

## 一、核心判断

### 1.1 两类约束的本质区别

| 维度 | 代码质量约束 | 知识积累 |
|------|-------------|----------|
| 本质 | 补偿模型弱点 | 做模型做不到的事 |
| 趋势 | 模型越强越多余 | 越积累越有价值 |
| 例子 | "不能用 any 类型" | "广告预算高并发会超扣" |
| 可替代性 | 模型自己会做好 | 只有踩过坑的团队才知道 |
| 生命周期 | 消耗品，会过时 | 积累品，有复利 |

### 1.2 Harness 的新定位

```
今天：代码质量约束系统（补偿模型弱点）
        ↓
未来：知识积累基础设施（模型做不到的事）
      + 最小安全护栏（模型无关的底线）
```

**核心理念：Harness 不是目的，知识才是护城河。**

Studio 侧同步转型：从"人驱动、AI 辅助"的 Workflow 模式，进化为"AI Agent OS"——Agent 自主执行，人退居审批者。（详见 §12.8 "Workflow 模式落伍"、§12.9 "系统能力 MCP 化"、§12.10 "三层 Agent 架构"）

参考：腾讯 AI Team 的实践——"Skill、Agent、工具链会随模型迭代更新，但领域知识是永恒的。"

---

## 二、知识闭环：设计的唯一主线

> 所有子系统——上下文管理、安全护栏、验证循环——都是为了让知识流动得更好。
> 不是从"Agent 怎么执行"出发，而是从"知识怎么积累"出发。

### 2.1 知识闭环五阶段

```
                    ┌──────────────────────────────┐
                    │         知识闭环              │
                    │                              │
                    │   ① 来 ──→ ② 存 ──→ ③ 用    │
                    │                  ↑       ↓    │
                    │                  ⑤ 好 ←─ ④ 对 │
                    │                              │
                    └──────────────────────────────┘
```

| 阶段 | 问题 | 核心动作 |
|------|------|----------|
| ① 来 | 知识从哪来？ | 冷启动导入、执行中提取、团队共建 |
| ② 存 | 知识怎么存？ | 三维体系、渐进式索引、文件即知识 |
| ③ 用 | 知识怎么用？ | 按需查询、预算控制、上下文注入 |
| ④ 对 | 怎么保证用对了？ | 安全护栏、验证循环、约束系统 |
| ⑤ 好 | 怎么越用越好？ | 成熟度升降、自动衰减、进化引擎（详见 12.12） |

### 2.2 为什么知识闭环是唯一主线

传统设计按子系统分：上下文管理、安全、监控、约束——每个独立设计，最后拼装。

我们的设计按知识流动分：每个子系统都是知识闭环某个阶段的实现。

| 子系统 | 在闭环中的位置 | 服务对象 |
|--------|---------------|----------|
| 知识引擎（存储/索引/查询） | ② 存 + ③ 用 | 知识的存取 |
| 上下文管理（Token 流水线） | ③ 用 | 知识注入到 Agent |
| 安全护栏（三层防护） | ④ 对 | 防止错误的知识消费 |
| 验证循环（规则/视觉/LLM） | ④ 对 | 验证基于知识的决策 |
| 约束系统（safety/quality） | ④ 对 | 约束知识质量 |
| 生命周期（成熟度/衰减/Lint） | ⑤ 好 | 知识自我进化 |
| 进化引擎（Evolution Engine） | ⑤ 好 | 约束进化、Skill 优化、角色画像、SOP 提取 |
| Dashboard + 监控 | ⑤ 好 | 可观测性 |
| 冷启动导入 + ARCHIVE 提取 | ① 来 | 知识的入口 |

### 2.3 知识流动全景

```
┌─────────────────────────────────────────────────────────────────┐
│                        知识闭环全景                               │
│                                                                  │
│  ① 来                                                            │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                     │
│  │冷启动导入 │   │执行中提取 │   │团队共建   │                     │
│  │(import.ts)│   │(ARCHIVE) │   │(Git协作)  │                     │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘                     │
│       └──────────────┼──────────────┘                            │
│                      ▼                                           │
│  ② 存                                                            │
│  ┌──────────────────────────────────────────┐                    │
│  │  五层存储 × 五种类型 × 三级成熟度          │                    │
│  │  渐进式索引（A全景 → B分类 → C条目）       │                    │
│  │  文件系统即知识库（.harness/knowledge/）   │                    │
│  └──────────────────┬───────────────────────┘                    │
│                     ▼                                            │
│  ③ 用                                                            │
│  ┌──────────────────────────────────────────┐                    │
│  │  Token 流水线（收集→排序→压缩→预算→组装）  │                    │
│  │  知识注入（按阶段预算，P3 位置）           │                    │
│  │  观察屏蔽 + JIT 检索                      │                    │
│  └──────────────────┬───────────────────────┘                    │
│                     ▼                                            │
│  ④ 对                                                            │
│  ┌──────────────────────────────────────────┐                    │
│  │  安全护栏（输入/输出/工具 三层）           │                    │
│  │  验证循环（规则/视觉/LLM 裁判）           │                    │
│  │  约束系统（安全底线 + 可退化质量约束）     │                    │
│  │  Sandbox（Level 1-4 安全级别）            │                    │
│  └──────────────────┬───────────────────────┘                    │
│                     ▼                                            │
│  ⑤ 好                                                            │
│  ┌──────────────────────────────────────────┐                    │
│  │  成熟度升降（draft→verified→proven）      │                    │
│  │  自动衰减（12月/6月/Lint三级）            │                    │
│  │  冲突解决（自动合并 + maintainer 裁决）   │                    │
│  │  Dashboard + 上下文可观测性               │                    │
│  └──────────────────┬───────────────────────┘                    │
│                     │                                            │
│                     └──────── 回到 ③ 用（下次自动受益） ────────  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、知识从哪来（① 来）

### 3.1 三种知识来源

| 来源 | 触发时机 | 产出 |
|------|----------|------|
| **冷启动导入** | 项目首次接入，无历史知识 | 从代码/文档/口述中批量提取，maturity: draft |
| **执行中提取** | 每次工作流完成（ARCHIVE 阶段） | 从产物中自动提取，maturity: draft |
| **团队共建** | 成员主动贡献或验证 | 通过 Git 协作，成熟度随验证提升 |

### 3.2 冷启动导入

对于已有代码但没有知识库的项目，通过多源收集冷启动：

```
代码仓库扫描 → 技术栈/模块/依赖/模式
Git 历史分析 → 架构决策/重构记录/hotfix 原因
文档导入     → README/Wiki/设计文档
口述录入     → 团队成员的经验（结构化模板）
```

所有导入知识初始 maturity 为 draft（置信度 0.5-0.6），通过后续使用逐步验证提升。

导入过程通过 `.harness/import-state.json` 持久化进度，支持中断后继续。

### 3.3 ARCHIVE 阶段知识提取

**ARCHIVE** 是工作流的最后一个阶段——工作流完成时自动触发，从全流程产物中提取知识并入库。它不是一个独立的工作流，而是每个工作流的收尾步骤。

工作流完成时，从全流程产物中自动提取知识：

```
工作流完成
  ↓
收集各阶段产物（架构文档、代码变更、测试报告、review 评论）
  ↓
LLM 提取候选知识条目（每个阶段最多 3 条）
  ↓
去重检查（与已有知识库比对相似度 > 0.8 的跳过）
  ↓
写入 .harness/knowledge/（maturity: draft）
  ↓
记录 source_references（workflow ID + step + commit）
  ↓
执行成熟度判定（见 七、怎么越用越好）
```

提取策略：

| 产物来源 | 提取类型 | 优先级 |
|----------|----------|--------|
| 架构决策文档 | decision | 高 |
| 踩坑记录 / 错误日志 | pitfall | 高 |
| 代码注释中的 WARN/NOTE | guideline | 中 |
| 重复出现的代码模式 | model | 中 |
| 部署/操作步骤 | process | 低 |

### 3.4 团队知识共建

团队知识库是独立 Git 仓库，不寄生于任何业务项目：

```
team-knowledge.git
├── knowledge-catalog.md          ← 全景目录
├── team-conventions/             ← Layer 0-T: 团队约定
├── tech-wiki/                    ← Layer 1: 技术知识
├── domain-wiki/{domain}/         ← Layer 2: 领域知识
├── project-profiles/             ← 项目画像
└── contributions/                ← 贡献暂存区
    ├── pending/
    └── conflicts/
```

三种角色：

| 角色 | 权限 | 适用人群 |
|------|------|----------|
| maintainer | 裁决冲突、审批 proven 提升、管理成员 | 团队负责人、资深工程师 |
| contributor | 通过工作流自动贡献（创建/验证/标记矛盾） | 正式团队成员 |
| reader | 只消费知识（查询/注入），不贡献 | 新成员试用期 |

贡献模式：贡献暂存 + 异步合并。大多数情况（纯新增、证据追加、成熟度提升）自动处理，只有内容矛盾才需要人工介入。

---

## 四、知识怎么存（② 存）

### 4.1 三维正交知识体系

采用 **五层存储 × 五种类型 × 三级成熟度**：

#### 存储层（按共享边界分）

```
Layer 0-P  个人偏好     ~/.harness/preferences/     纯本地，不共享
Layer 0-T  团队约定     team-conventions/           团队级，Git 共享
Layer 1    技术知识     tech-wiki/                  团队级，跨项目
Layer 2    领域知识     domain-wiki/{domain}/       团队级，按领域
Layer 3    项目知识     .harness/knowledge/         项目级，随项目走
```

知识可以"向上提升"：Layer 3 项目知识如果跨项目通用，自动提升到 Layer 1 或 Layer 2。

提升判定逻辑：
```
Layer 3 (项目内)
  │  所有类型，maturity 为 draft
  │
  ├──→ Q1: 是否项目特有？ → 是：留在 Layer 3
  ├──→ Q2: 是否通用技术？ → 是：提升到 Layer 1 (tech-wiki)
  └──→ Q3: 是否通用业务？ → 是：提升到 Layer 2 (domain-wiki)
```

**跨层查询规则：** 查询时按 Layer 3 → 2 → 1 → 0-T → 0-P 顺序查找，命中即停。项目知识优先于团队知识，团队知识优先于个人偏好。同层内按 maturity 降序排列（proven > verified > draft）。

**层间隔离：** Layer 0-P 仅本人可见，不参与团队查询。Layer 0-T/1/2 通过 Git 仓库隔离团队边界，跨团队共享需 maintainer 授权。Layer 3 随项目走，项目归档则知识归档。

#### 知识类型（MECE）

| 类型 | 定义 | 示例 |
|------|------|------|
| `model` | 实体定义、数据结构、关系 | "Agent 有 role 和 stance 两个核心属性" |
| `decision` | 架构决策 + 理由 | "选择 PostgreSQL 而非 MongoDB，因为需要事务" |
| `guideline` | 推荐/禁止做法 | "recommend: 并发操作用 Redis+Lua 保证原子性" |
| `pitfall` | 已知风险、故障模式 | "预算扣减在高并发下会超扣" |
| `process` | 业务流程、操作步骤 | "部署流程：构建→测试→灰度→全量" |

#### 成熟度

```
draft（新提取，单一来源）
  ↓ 被引用 1 次
verified（单项目验证）
  ↓ 被引用 ≥3 次 + ≥2 个不同项目中验证
proven（成熟/可信赖）
```

成熟度升降的详细触发条件见 七、怎么越用越好。

### 4.2 知识条目格式

```yaml
# .harness/knowledge/TK-PAT-001.md
---
id: TK-PAT-001
type: pitfall
title: "Redis 分布式锁在主从切换时可能丢失"
maturity: proven
created: 2026-03-15
last_referenced: 2026-04-28
contributors: [alice, bob]
projects: [ad-system, payment-service]
tags: [redis, distributed-lock, high-availability]
applicable_phases: [IMPLEMENT, ARCHITECT]
source_references:
  - workflow: wf-2026-03-15-001
    step: implement-lock-service
---

## 问题描述

Redis 主从架构下，主节点写入锁后宕机，从节点提升为主节点，
其他客户端可以获取同一把锁，导致并发问题。

## 推荐做法

使用 RedLock 算法，或改用 etcd/Consul 等 CP 系统。

## 已知案例

- ad-system 2026-03-15 线上事故：预算扣减并发超扣
- payment-service 2026-04-01 测试环境复现
```

### 4.3 渐进式索引

```
Layer A: 全景目录    knowledge-catalog.md    ~50 行
  → "知识库有什么？"  分类统计 + 推荐查阅路径

Layer B: 分类清单    各目录 catalog.md       ~100-300 行
  → "这个分类有哪些？"  每条一行摘要（ID + 标题 + 成熟度 + 标签）

Layer C: 完整条目    TK-*.md / BK-*.md       ~50-200 行
  → "这条知识说了什么？"  完整内容 + 背景 + 适用场景
```

Agent 用 ~50 行成本了解全貌，~300 行定位相关条目，只在真正需要时读取完整内容。

### 4.4 知识存储目录结构

```
.harness/
├── knowledge/                    ← 项目级知识 (Layer 3)
│   ├── knowledge-catalog.md      ← Layer A: 全景目录
│   ├── model/
│   │   ├── catalog.md            ← Layer B: 分类清单
│   │   └── TK-MOD-001.md         ← Layer C: 完整条目
│   ├── decision/
│   │   ├── catalog.md
│   │   └── TK-DEC-001.md
│   ├── guideline/
│   ├── pitfall/
│   └── process/
│
├── conflicts/                    ← 冲突待裁决
├── references.jsonl              ← 引用追踪日志（只追加）
├── lifecycle.jsonl               ← 成熟度变更日志（只追加）
├── lint-reports/                 ← Lint 报告存档
├── progress.yml                  ← 任务状态恢复
└── dashboard/                    ← Dashboard 数据缓存
    ├── knowledge-stats.json
    ├── constraint-stats.json
    └── feedback-loops.json
```

团队级知识（Layer 0-T ~ Layer 2）在独立 Git 仓库中，结构相同。

---

## 五、知识怎么用（③ 用）

> 上下文窗口不是聊天记录，是工作集。Harness 每一轮调用前整理一份"当下能用"的窗口视图。

### 5.1 查询预算

每个 Agent 阶段有独立的查询预算，防止上下文膨胀：

| 阶段 | 查询焦点 | 重点类型 | 预算上限 |
|------|----------|----------|----------|
| 分析 | 领域知识 + 历史决策 | model, process, pitfall | 500 tokens |
| 设计 | 架构模式 + 已知陷阱 | decision, guideline(avoid) | 800 tokens |
| 实现 | 编码实践 + 团队约定 | guideline, pitfall | 300 tokens |
| 验证 | 反模式库 + 测试策略 | pitfall, guideline(avoid) | 200 tokens |

### 5.2 知识注入流程

知识不是"推送"给 Agent，而是按需查询、精准注入：

```
Agent 执行到某个阶段
  ↓
ContextManager 调用 KnowledgeEngine.query({
  phase: currentPhase,           // 当前阶段
  budget: phaseBudget,           // 该阶段的 token 预算
  focusTypes: phaseFocusTypes,   // 该阶段关注的知识类型
  exclude: alreadyInjected,      // 已注入的条目 ID（去重）
})
  ↓
KnowledgeEngine 返回 QueryResult（entries + tokensUsed）
  ↓
ContextManager 将知识条目格式化为系统消息片段
  ↓
插入到 prompt 的 P3 位置（工具定义之后、对话历史之前）
```

去重策略：同一会话内，已注入的知识条目不重复注入，但可以注入其摘要版本（ID + 标题 + 一行摘要）。

### 5.3 Token 转换流水线

每次 LLM 调用前，所有上下文素材经过统一的五步流水线：

```
收集 → 排序 → 压缩 → 预算 → 组装
 │       │       │       │       │
 │       │       │       │       └─ 按优先级栈拼装（5.4）
 │       │       │       └─ 按预算裁剪（5.5 + 5.6）
 │       │       └─ 观察屏蔽 + 驱逐 + 总结（5.7）
 │       └─ 按优先级排序（5.4 的 P1-P6）
 └─ 从各来源拉取：session 事件、工具输出、知识条目、用户消息
```

关键特性：
- 每次 LLM 调用前运行，不等窗口满了再整理
- 流水线各步骤可独立配置和替换
- 输出是 `ContextUsageSnapshot`，可追踪每步的 token 消耗

接口签名：

```typescript
interface TokenPipeline {
  // 完整流水线：收集 → 排序 → 压缩 → 预算 → 组装
  run(input: PipelineInput): Promise<PipelineOutput>;

  // 各步骤可独立调用（用于测试和调试）
  collect(sources: ContextSource[]): Promise<RawContext>;
  sort(items: RawContext): Promise<SortedContext>;
  compress(items: SortedContext, budget: number): Promise<CompressedContext>;
  assemble(compressed: CompressedContext, priority: PriorityStack): Promise<string>;
}

interface PipelineInput {
  sources: ContextSource[];     // session 事件、工具输出、知识条目、用户消息
  budget: TokenBudget;          // 总预算 + 各类子预算
  priority: PriorityStack;      // P1-P6 优先级栈
  knowledge: QueryResult;       // 已查询的知识条目
}

interface PipelineOutput {
  prompt: string;               // 最终组装的 prompt
  snapshot: ContextUsageSnapshot;
  dropped: Array<{ type: string; id: string; reason: string }>;
}
```

### 5.4 提示词组装优先级栈

```
优先级 1: 系统提示词（安全约束、不可覆盖的角色定义）
优先级 2: 工具定义（当前可见工具的 schema）
优先级 3: 知识注入（与当前任务相关的知识条目）
优先级 4: 结构化笔记（任务计划、已确认事实、关键路径）
优先级 5: 对话历史（最近 N 轮，旧的观察屏蔽）
优先级 6: 用户消息（当前输入）
```

**关键**：重要的上下文放在提示词的开头和结尾（"中间迷失"现象——中间位置的内容被关注的概率低 30%+）。

**预算分配**：

| 优先级 | 内容 | Token 预算占比 |
|--------|------|---------------|
| P1 | 系统提示词 | 固定，不压缩 |
| P2 | 工具定义 | 按需懒加载 |
| P3 | 知识注入 | 500-800 tokens |
| P4 | 结构化笔记 | 200-500 tokens |
| P5 | 对话历史 | 剩余预算 |
| P6 | 用户消息 | 不限 |

### 5.5 文件读取预算

没人假设模型会天然节制。先限流，再教模型分页：

| 系统 | 文件限制 | 策略 |
|------|----------|------|
| Pi | 2000 行或 50KB | 先到先停，末尾提示 offset |
| Claude Code | 256KB 拒绝 + 2000 行默认 | stat 前置 + token 预算兜底 |
| Letta Code | 10MB 拒绝 + 2000 行窗口 | 超出写 overflow 文件 |

**设计原则**：文件读取是接口，不是特权。跟 API 分页、限流、超时一样——不因为调用方"理论上可以少请求"就不做预算。

### 5.6 工具输出预算

工具输出是最容易被低估的上下文黑洞：

| 策略 | 做法 |
|------|------|
| 硬上限 | 每类工具输出给字符/token 上限 |
| Preview | 超大的只留开头、结尾或摘要 |
| Overflow | 完整内容写磁盘，给模型一个路径 |
| 去重 | 重复读取做 dedup，别反复进上下文 |
| 预整理 | 每次 API 调用前就整理，不等窗口满了再救火 |

### 5.7 观察屏蔽 + JIT 检索

**观察屏蔽**：当对话历史变长时，隐藏旧轮次的工具输出（大文本），但保留工具调用记录（小文本）。模型能看到"我之前调了什么工具"，但不需要看到完整的返回内容。需要时再重新调用。

**JIT 检索**：不预加载文件，而是给模型提供搜索工具（grep、glob、head、tail），让它按需定位和读取。Claude Code 用这种方式实现 95% 的上下文缩减。

### 5.8 会话压缩

不是"把历史变短"，是"把任务状态迁移到更稳定的位置"。分三档：

| 档位 | 方式 | 适用场景 |
|------|------|----------|
| 轻量 | 确定性驱逐，按比例丢最早消息 | 短任务 |
| 中等 | LLM 结构化总结，保留 tool-call 边界 | 中等任务 |
| 重型 | checkpoint + 记忆迁移，压缩前先自我整理 | 长任务 |

**结构化总结维度**：用户目标、关键文件、已做修改、失败原因、当前计划、下一步动作。不能只留"对话摘要"。

**边界 case**：压缩本身也会撑爆窗口。需要兜底——先钳制工具输出再重试，仍不行就做中间截断（留头留尾）。

### 5.9 子智能体隔离

默认隔离，只给任务字符串，不复制父上下文：

- 子 Agent 只拿到任务描述，不带父 transcript
- 探索过程挡在父窗口外，只把结论交回来（1000-2000 token 摘要）
- 隔离后需要定义"最小必要上下文"（AGENTS.md、工具列表等）

三种执行模式：

| 模式 | 特征 | 适用场景 |
|------|------|----------|
| **Fork** | 父上下文的字节级精确副本 | 需要完整上下文的分支任务 |
| **Teammate** | 独立终端面板，通过文件邮箱通信 | 并行协作，需要共享状态 |
| **Worktree** | 独立 git 工作树 + 隔离分支 | 代码探索，需要隔离修改 |

### 5.10 session / harness / sandbox 解耦

| 组件 | 职责 | 类比 |
|------|------|------|
| Session | 持久事件日志，窗口外保存 | 数据库 WAL |
| Harness | 组织每轮窗口视图 | 内存管理器 |
| Sandbox | 执行工具和代码 | 操作系统进程 |

Session 不等于上下文窗口。Session 是持久事件日志，可以在窗口外保存可恢复的上下文；Harness 再决定每一轮把哪些事件切片、变换、组织好放回模型窗口。

### 5.11 检查点策略

| 检查点类型 | 实现 | 用途 |
|-----------|------|------|
| **Git commit** | 每完成一个有意义的步骤自动提交 | 代码状态恢复，"时光倒流"调试 |
| **Progress file** | `.harness/progress.yml` 结构化草稿本 | 任务状态恢复（当前计划、已完成步骤、待办） |
| **Session log** | JSONL 事件日志 | 审计和回放 |
| **Knowledge snapshot** | 知识库引用状态快照 | 知识状态恢复 |

中断恢复流程：
```
1. 读取 progress.yml → 恢复任务计划
2. 读取 git log → 恢复代码状态
3. 读取 session log → 恢复对话上下文（压缩后）
4. 读取知识引用 → 恢复知识上下文
5. 从断点继续执行
```

### 5.12 上下文可观测性

核心度量指标：

| 指标 | 含义 | 目标 |
|------|------|------|
| 上下文利用率 | 已用 token / 窗口大小 | 60-80%（留余量） |
| 信噪比 | 有用信息 token / 总 token | >70% |
| 压缩触发频率 | 每 10 轮触发次数 | <2 |
| 工具输出占比 | 工具输出 token / 总 token | <30% |
| 知识命中率 | 知识查询返回相关结果的比例 | >50% |

---

## 六、怎么保证用对了（④ 对）

### 6.1 三层安全护栏

安全护栏是永久保留的，不随模型能力提升而退化：

```
┌───────────────────────────────────────────────────────┐
│                    三层安全护栏                         │
├───────────────┬───────────────────┬───────────────────┤
│  输入护栏      │  工具护栏          │  输出护栏          │
│  (首个Agent前) │  (每次工具调用)    │  (最终输出前)      │
├───────────────┼───────────────────┼───────────────────┤
│  注入防御      │  命令黑名单        │  敏感信息审查      │
│  意图校验      │  Sandbox 级别检查  │  代码质量检查      │
│  权限验证      │  速率限制          │  知识引用完整性    │
└───────────────┴───────────────────┴───────────────────┘
```

每层独立工作，任一层拦截即阻断执行。

### 6.2 Sandbox 安全级别

| 级别 | 权限 | 适用场景 |
|------|------|----------|
| Level 1 | 只读文件系统，无网络，无 shell | 知识查询、代码分析 |
| Level 2 | 可写限定目录（.harness/），无网络 | 知识写入、本地分析 |
| Level 3 | 可写项目目录，受限网络（白名单） | 编码、测试、npm install、Git 操作 |
| Level 4 | 完全权限，需用户确认 | 生产部署、数据库操作 |

编码 Agent 默认在 Level 3 运行（需要写项目目录 + 网络）。只读分析任务使用 Level 1-2。Level 4 需要显式用户确认。

### 6.3 验证循环

验证不只是"测试通过"，而是三种验证方式的组合：

```
┌─────────────────────────────────────────────────────┐
│                    验证循环                           │
├──────────────────┬──────────────────┬───────────────┤
│  规则验证          │  视觉验证          │  推理验证     │
│  (确定性)          │  (截图比对)        │  (LLM 裁判)  │
├──────────────────┼──────────────────┼───────────────┤
│  测试通过          │  UI 截图检查       │  代码审查     │
│  Linter 无错误    │  回归检测          │  架构合理性   │
│  类型检查通过      │  响应时间基线      │  知识一致性   │
└──────────────────┴──────────────────┴───────────────┘
```

验证循环流程（Gather-Act-Verify）：
```
Gather：收集当前状态（代码、测试结果、截图）
  ↓
Act：执行动作（修复、重构、优化）
  ↓
Verify：验证结果（三种方式按需组合）
  ↓
通过 → 继续下一步
失败 → 重新 Gather（最多 N 次）
```

### 6.4 错误处理：四类错误分类

| 错误类型 | 特征 | 处理策略 |
|----------|------|----------|
| **瞬时** | 网络超时、API 限流 | 退避重试（指数退避） |
| **LLM 可恢复** | 工具参数错误、格式不对 | 包装为 ToolMessage 反馈给 LLM 自修复 |
| **用户可修复** | 缺少权限、需要确认 | 中断，等待人工输入 |
| **意外** | 系统 bug、数据损坏 | 快速失败，抛异常便于调试 |

---

## 七、怎么越用越好（⑤ 好）

### 7.1 成熟度升降触发条件

| 升级条件 | 动作 |
|----------|------|
| draft 被 1 次工作流成功引用（引用后任务未回退） | → verified |
| verified 被 ≥2 个不同项目验证（projects[] 长度 ≥2） | → proven |

| 降级条件 | 动作 |
|----------|------|
| proven 12 个月未被引用 | → verified |
| verified 6 个月未被引用 | → draft |
| draft 持续未引用 + Lint 标记 | → 归档（移出活跃索引） |

| 特殊条件 | 动作 |
|----------|------|
| 引用后任务回退/失败 | 不计入成功引用 |
| 同一条知识被标记矛盾 | 冻结升降，等待裁决 |

### 7.2 引用追踪闭环

```
Agent 查询知识 → 在产物中记录 knowledgeReferences
  ↓
ARCHIVE 阶段读取所有引用
  ↓
更新 last_referenced 字段
  ↓
成熟度自动升降（引用多→升级，长期未引用→降级）
```

### 7.3 知识冲突解决

| 冲突类型 | 处理方式 |
|----------|----------|
| 纯新增（不同条目） | 自动合并 |
| 证据追加（同条目验证） | 自动合并，evidence 去重 |
| 成熟度提升 | 自动合并 |
| **内容矛盾** | 写入 `conflicts/` 目录，通知 maintainer 裁决 |
| **成熟度冲突**（一升一降） | 保留较低成熟度 + 标记 contradiction |

矛盾裁决流程：
```
新知识 A 与已有知识 B 冲突
  ↓
自动标记：A.status = 'conflicting', B.status = 'frozen'
  ↓
写入 .harness/conflicts/{timestamp}-{A.id}-{B.id}.json
  ↓
通知 maintainer（通过 monitoring 事件）
  ↓
裁决结果：保留 A / 保留 B / 合并为 C
  ↓
更新知识库，解除 frozen 状态
```

### 7.4 知识库 Lint（健康检查）

| 检查项 | 处理方式 |
|--------|----------|
| 索引不一致 | 自动修复 |
| 孤儿条目（无引用、无验证） | 降级为 draft |
| 矛盾检测（同主题相反结论） | 标记冲突，等待 maintainer 裁决 |
| 过时检测（6 月未引用的 draft） | 自动归档 |
| 重复/相似条目 | 标记合并候选 |
| 成熟度衰减 | 按规则自动降级 |

触发方式：每完成 10 个工作流自动触发、手动触发、连续 30 天未执行时在下次启动时提醒。

---

## 八、怎么看得见

### 8.1 三层反馈环

```
┌─────────────────────────────────────────────────────────────┐
│                    三层反馈环                                  │
├──────────────┬──────────────────┬────────────────────────────┤
│  本地反馈     │  推送反馈         │  外部反馈                   │
│  (开发时)     │  (提交后)         │  (上线后)                   │
├──────────────┼──────────────────┼────────────────────────────┤
│  编译         │  Code Review     │  运行监控                   │
│  测试         │  CI/CD           │  用户反馈                   │
│  Lint         │  质量门禁         │  线上故障                   │
│  约束检查     │  架构规则检查     │  知识验证                   │
└──────────────┴──────────────────┴────────────────────────────┘
        ↑                ↑                    ↑
        └────────────────┴────────────────────┘
                   反馈回流到知识库
```

三层反馈不是"多几道检查"，而是把工程从一次性动作变成持续收敛的过程。

### 8.2 系统可控的三种能力

| 能力 | 含义 | 对应组件 |
|------|------|----------|
| **可读性** | Spec 从哪来、决策在哪、Agent 该读什么——可发现、可导航 | 知识全景目录 + 索引 |
| **约束生效** | 哪些规则会拦截、哪些放行、哪些升级——可执行、可预期 | 约束执行热力图 |
| **反馈回流** | 不只停在 CI log 里，能被下一轮决策消费——持续收敛 | 引用追踪闭环 |

### 8.3 Dashboard（studio 侧实现）

harness 提供数据，studio 负责渲染。Dashboard 包含四个视图：

#### 视图一：知识库全景

```
┌─────────────────────────────────────────────────┐
│  知识库概览                                       │
├──────────┬──────┬──────┬──────┬─────────────────┤
│ 类型      │ 总数 │ 成熟 │ 验证 │ 草稿             │
├──────────┼──────┼──────┼──────┼─────────────────┤
│ model     │  12  │   8  │   3  │  1              │
│ decision  │  23  │  15  │   5  │  3              │
│ guideline │  18  │  10  │   6  │  2              │
│ pitfall   │   9  │   6  │   2  │  1              │
│ process   │   7  │   4  │   2  │  1              │
├──────────┼──────┼──────┼──────┼─────────────────┤
│ 合计      │  69  │  43  │  18  │  8              │
└──────────┴──────┴──────┴──────┴─────────────────┘

  成熟度分布:  ████████████████░░░░  62% proven
              ████████░░░░░░░░░░░░  26% verified
              ███░░░░░░░░░░░░░░░░░  12% draft

  即将衰减:    3 条 proven 条目 6 个月内未引用
              5 条 verified 条目 3 个月内未引用
```

#### 视图二：约束执行热力图

```
┌─────────────────────────────────────────────────┐
│  约束执行统计 (近 30 天)                           │
├──────────────────────────┬──────┬───────┬───────┤
│ 约束                      │ 触发 │ 通过  │ 拦截  │
├──────────────────────────┼──────┼───────┼───────┤
│ no_bypass_checkpoint      │  45  │  45   │   0   │  ← 安全底线，永久保留
│ CommandGate               │  12  │  12   │   0   │  ← 安全底线，永久保留
│ no_self_approval          │  38  │  35   │   3   │  ← 质量约束，待退化
│ no_any_type               │ 120  │  98   │  22   │  ← 模型在改善，拦截率下降
│ simplest_solution_first   │  67  │  60   │   7   │  ← 模型在改善，拦截率下降
│ no_creation_without_reuse │  23  │  20   │   3   │  ← 转型为知识复用检查
└──────────────────────────┴──────┴───────┴───────┘

  从未触发:  capability_sync, test_coverage_required
  拦截率↓:  no_any_type (22%→15%), 模型能力提升中
```

#### 视图三：知识流转路径

```
┌─────────────────────────────────────────────────┐
│  知识流转 (近 30 天)                               │
│                                                   │
│  提取 ──→ 入库 ──→ 引用 ──→ 升级/衰减              │
│   12       12       47        5↑  2↓              │
│                                                   │
│  ┌─────────────────────────────────────────┐     │
│  │ draft → verified:  4 条 (引用 ≥1 次)     │     │
│  │ verified → proven: 1 条 (≥2 项目验证)    │     │
│  │ proven → verified: 1 条 (12 月未引用)    │     │
│  │ verified → draft:  1 条 (6 月未引用)     │     │
│  └─────────────────────────────────────────┘     │
│                                                   │
│  高频引用 Top 5:                                   │
│  1. TK-PAT-003  分页查询延迟关联优化     引用 12 次 │
│  2. TK-DEC-001  PostgreSQL 选型决策      引用  9 次 │
│  3. TK-GL-005   Redis+Lua 原子操作      引用  8 次 │
│  4. TK-PAT-001  Redis 分布式锁陷阱      引用  7 次 │
│  5. TK-PR-002   灰度发布流程            引用  6 次 │
└─────────────────────────────────────────────────┘
```

#### 视图四：反馈环状态

```
┌─────────────────────────────────────────────────┐
│  反馈环状态                                       │
├──────────────┬──────────┬───────────────────────┤
│ 层级          │ 活跃数   │ 最近回流               │
├──────────────┼──────────┼───────────────────────┤
│ 本地反馈      │  89 条   │ 2 分钟前 (lint 警告)   │
│ 推送反馈      │  23 条   │ 1 小时前 (PR review)   │
│ 外部反馈      │   5 条   │ 3 小时前 (线上告警)    │
├──────────────┼──────────┼───────────────────────┤
│ 已回流到知识库 │  12 条   │ 待处理: 3 条           │
└──────────────┴──────────┴───────────────────────┘
```

### 8.4 Dashboard 数据接口

harness 向 studio 暴露 `HarnessDashboardData` 数据接口（纯文件读取，零 token 开销）。

> 接口类型定义见 十、架构改造 中的类型系统。

---

## 九、约束系统的去向

### 9.1 现有约束的价值判定

约束分三类，生命周期各不同：

#### 永久保留（模型无关的安全底线）

| 约束 | 理由 |
|------|------|
| **CommandGate**（20 条命令黑名单） | `rm -rf /` 不管模型多强都不能执行 |
| **SecurityGate**（敏感文件审计） | .env、密钥访问必须留审计日志 |
| **跨项目接口一致性** | 多仓库协调问题，不是模型能力问题 |
| **架构规则引擎**（forbidden-pattern） | 团队架构边界的硬约束 |

#### 逐步退化（模型会自己做好）

| 约束 | 当前状态 | 退化路径 |
|------|----------|----------|
| `no_self_approval` | Iron Law | → Guideline → 移除 |
| `no_test_simplification` | Iron Law | → Guideline → 移除 |
| `no_any_type` | Guideline | → Tip → 移除 |
| `simplest_solution_first` | Guideline | → Tip → 移除 |
| `no_code_without_test` | Guideline | → 模型自发行为 |
| `incremental_progress` | Iron Law | → 可选配置 |

#### 转型为知识约束

| 现有约束 | 转型方向 |
|----------|----------|
| `no_fix_without_root_cause` | → 知识条目必须有因果链（不只是结论） |
| `capability_sync` | → 工具/能力变更必须同步知识库 |
| `design_decision_requires_discussion` | → 架构决策必须沉淀为 decision 类型知识 |
| ConstraintDoctor | → KnowledgeDoctor（知识库健康检查） |
| ConstraintEvolver | → KnowledgeEvolver（知识成熟度进化） |

### 9.2 约束分层

```
constraints/
├── safety.ts       ← 永久安全约束（CommandGate、SecurityGate 等）
├── quality.ts      ← 可退化质量约束（标记 deprecated-schedule）
└── definitions.ts  ← 兼容入口（保留旧 API）
```

### 9.3 渐进式退化机制

质量约束不是一刀切移除，而是按拦截率数据驱动退化：

```
约束拦截率持续下降（如 no_any_type: 22% → 15% → 8%）
  ↓
Dashboard 标记为"退化候选"
  ↓
maintainer 审批退化计划
  ↓
Iron Law → Guideline → Tip → 移除
```

每个退化步骤都有回滚机制：如果退化后拦截率反弹，自动恢复原级别。

---

## 十、架构改造

### 10.1 三包合一

harness、runtime、workflow 合并为一个统一包。

**为什么合一**：
- Agent 执行天然需要：知识注入（harness）+ 工具执行（runtime）+ 工具注册（workflow）
- 如果分开，三个包之间的接口就是额外的复杂度
- workflow 不是"流程编排"，是"工具注册表 + 约束配置"——这正是 harness 需要的
- runtime 的有价值功能（Agent 生命周期、LLM 客户端、质量保障）都是通用基础设施

### 10.2 两仓库架构

```
之前（三仓库）：
┌─────────────────────────────────────────────────┐
│  agent-studio    (产品层，业务逻辑)               │
├─────────────────────────────────────────────────┤
│  agent-platform  (执行层，runtime + workflows)   │
├─────────────────────────────────────────────────┤
│  harness         (基础层，约束框架)               │
└─────────────────────────────────────────────────┘

之后（两仓库）：
┌──────────────────────────────────────────────────────────┐
│                agent-studio (产品层)                       │
│  业务逻辑：角色/治理/经济/会议                             │
│  可视化：Harness Dashboard UI                             │
│  直接依赖 @dommaker/harness                               │
├──────────────────────────────────────────────────────────┤
│                @dommaker/harness (核心层)                  │
│  知识闭环 + 上下文管理 + 安全护栏 + 验证循环              │
│  约束系统 + 工具注册表 + LLM 适配器 + Agent 生命周期      │
│  监控 + Dashboard 数据 + Token 流水线                     │
│  零业务逻辑，通用 Agent 基础设施                           │
└──────────────────────────────────────────────────────────┘

agent-platform 仓库：归档，不再维护。
```

关键边界：
- harness 提供所有通用 Agent 基础设施
- harness 不含业务逻辑（角色、薪资、治理属于 studio）
- studio 直接依赖 harness，注入 LLM 配置和业务级约束
- harness 的 LLM 调用通过接口注入，不硬编码特定模型 SDK

### 10.3 包结构

```
@dommaker/harness（统一包，替代原 harness + runtime + workflows）
│
├── knowledge/                    ← 知识引擎
│   ├── types.ts                  ← KnowledgeEntry, KnowledgeType, MaturityLevel
│   ├── store.ts                  ← 知识存储（文件系统 + 索引）
│   ├── index-builder.ts          ← 三级渐进式索引构建
│   ├── query.ts                  ← 知识查询（带预算控制）
│   ├── lifecycle.ts              ← 成熟度升降 + 自动衰减
│   ├── reference-tracker.ts      ← 引用追踪闭环
│   ├── lint.ts                   ← 知识库健康检查
│   └── import.ts                 ← 冷启动导入
│
├── context/                      ← 上下文管理
│   ├── progressive-loader.ts     ← 通用 chunk 加载
│   ├── file-budget.ts            ← 文件读取预算
│   ├── tool-output-budget.ts     ← 工具输出预算
│   ├── compaction.ts             ← 会话压缩三档
│   ├── token-pipeline.ts         ← Token 流水线（收集→排序→压缩→预算→组装）
│   ├── session-manager.ts        ← session/harness/sandbox 解耦
│   ├── knowledge-injector.ts     ← 知识注入
│   └── token-budget.ts           ← token 预算管理
│
├── safety/                       ← 安全护栏（永久保留）
│   ├── command-gate.ts           ← 命令黑名单
│   ├── security-gate.ts          ← 敏感文件审计
│   ├── policy-gateway.ts         ← 统一策略网关
│   ├── sandbox.ts                ← 沙箱策略定义（Level 1-4）
│   ├── input-guardrail.ts        ← 输入护栏
│   ├── output-guardrail.ts       ← 输出护栏
│   └── tool-guardrail.ts         ← 工具护栏
│
├── verification/                 ← 验证循环
│   ├── rules-based.ts            ← 规则验证（测试/Linter/类型检查）
│   ├── visual.ts                 ← 视觉验证（Playwright 截图）
│   ├── llm-judge.ts             ← LLM 裁判（独立子 Agent 评估）
│   └── loop.ts                   ← 验证循环编排（Gather-Act-Verify）
│
├── failure/                      ← 失败处理
│   ├── classifier.ts             ← 错误分类
│   ├── recorder.ts               ← 失败记录
│   ├── error-types.ts            ← 四类错误（瞬时/LLM可恢复/用户可修复/意外）
│   └── retry.ts                  ← 重试策略
│
├── constraints/                  ← 约束系统
│   ├── safety.ts                 ← 永久安全约束
│   ├── quality.ts                ← 可退化质量约束
│   └── definitions.ts            ← 兼容入口
│
├── tools/                        ← 工具注册表（从 workflows 迁入）
│   ├── registry.ts               ← 工具注册/发现
│   ├── core/                     ← 核心工具（file/git/npm/shell）
│   ├── std/                      ← 标准工具
│   └── ext/                      ← 扩展工具
│
├── monitoring/                   ← 监控 + 可观测性
│   ├── traces.ts                 ← 追踪
│   ├── context-tracker.ts        ← 上下文使用追踪
│   ├── metrics.ts                ← 核心度量指标
│   ├── knowledge-doctor.ts       ← 知识库健康检查
│   └── knowledge-evolver.ts      ← 知识成熟度进化
│
├── dashboard/                    ← Dashboard 数据聚合
│   ├── data.ts                   ← HarnessDashboardData 聚合逻辑
│   └── stats.ts                  ← 统计计算
│
├── llm/                          ← LLM 适配器
│   ├── adapter.ts                ← LLMAdapter 接口定义
│   ├── default-adapter.ts        ← 默认实现（可被替换）
│   ├── gateway.ts                ← 模型网关（路由/fallback/统计）
│   └── types.ts
│
├── agents/                       ← Agent 生命周期管理（从 runtime 迁入）
│   ├── spawn.ts                  ← 启动 Agent
│   ├── monitor.ts                ← 监控 Agent
│   ├── fallback.ts               ← 回退策略
│   └── progress-parser.ts        ← 进度解析
│
├── architecture/                 ← 架构规则（保留）
├── spec/                         ← Spec 验证（保留）
├── presets/                      ← 预设配置（保留）
│
└── cli/                          ← CLI（保留）
```

### 10.4 控制平面 / 数据平面分层

```
┌─────────────────────────────────────────────────────────────┐
│                    控制平面（What）                           │
│  策略定义、调度、配额、约束规则                               │
├─────────────────────────────────────────────────────────────┤
│  constraints/     约束规则定义                               │
│  safety/          安全策略                                   │
│  knowledge/       知识查询策略（预算、类型过滤）             │
│  context/         上下文管理策略（压缩阈值、预算分配）       │
│  tools/           工具注册表（声明可用工具及其约束）         │
└─────────────────────────────────────────────────────────────┘
                          ↓ 策略下发
┌─────────────────────────────────────────────────────────────┐
│                    数据平面（How）                            │
│  执行、状态管理、存储、LLM 调用                              │
├─────────────────────────────────────────────────────────────┤
│  llm/             LLM 调用执行                               │
│  agents/          Agent 进程管理                             │
│  verification/    验证执行                                   │
│  monitoring/      数据采集和存储                             │
│  dashboard/       数据聚合                                   │
└─────────────────────────────────────────────────────────────┘
```

### 10.5 LLMAdapter 注入模式

harness 核心不硬编码 LLM 依赖，通过接口注入：

```typescript
interface LLMAdapter {
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
  summarize(messages: Message[], config: SummarizeConfig): Promise<string>;
  extract(content: string, schema: object): Promise<object>;
}
```

默认提供一个基础 adapter 实现，使用者可以替换为自己的实现（不同模型、不同网关）。

studio 使用方式：
```typescript
import { HarnessREPL, createLLMAdapter } from '@dommaker/harness';

const llm = createLLMAdapter({ provider: 'openai', model: 'gpt-4o' });
const harness = new HarnessREPL({ llm, knowledge, context, tools });
await harness.run(goal);
```

### 10.6 类型系统

```typescript
// knowledge/types.ts

export type KnowledgeType = 'model' | 'decision' | 'guideline' | 'pitfall' | 'process';
export type MaturityLevel = 'draft' | 'verified' | 'proven';
export type StorageLayer = 'personal' | 'team' | 'tech' | 'domain' | 'project';

export interface KnowledgeEntry {
  id: string;
  type: KnowledgeType;
  title: string;
  content: string;
  maturity: MaturityLevel;
  layer: StorageLayer;
  created: string;
  lastReferenced: string;
  contributors: string[];
  projects: string[];
  tags: string[];
  applicablePhases: string[];
  sourceReferences: SourceRef[];
  referencedBy: string[];       // 引用此条目的决策/任务 ID（反向索引）
  decayAt?: string;
}

export interface SourceRef {
  workflow?: string;
  step?: string;
  commit?: string;
  timestamp: string;
}

export interface KnowledgeReference {
  id: string;
  title: string;
  usedIn: string;
}

export interface QueryBudget {
  phase: string;
  maxTokens: number;
  maxEntries: number;
  focusTypes: KnowledgeType[];
}

export interface QueryResult {
  entries: KnowledgeEntry[];
  tokensUsed: number;
  truncated: boolean;
  fromCache: boolean;
}

export interface LintIssue {
  type: 'orphan' | 'contradiction' | 'outdated' | 'duplicate' | 'index_inconsistent';
  entryId?: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion: string;
}

// context/types.ts

export interface FileBudgetConfig {
  maxLines: number;              // 默认 2000
  maxBytes: number;              // 默认 50KB
  maxTokenEstimate: number;      // 默认 8000
  continuationHint: boolean;
}

export interface ToolOutputBudgetConfig {
  maxChars: number;              // 默认 16000
  maxTokenRatio: number;         // 默认 0.3
  previewLines: number;          // 默认 50
  overflowToDisk: boolean;
  dedup: boolean;
}

export type CompactionLevel = 'eviction' | 'summary' | 'checkpoint';

export interface CompactionConfig {
  triggerRatio: number;          // 默认 0.8
  level: CompactionLevel;
  preserveToolCallPairs: boolean;
  structuredSummary: boolean;
  maxSummaryTokens: number;
  fallbackStrategy: 'truncate-middle' | 'head-drop' | 'retry-with-clamp';
}

export interface ContextUsageSnapshot {
  timestamp: string;
  totalTokens: number;
  breakdown: {
    systemPrompt: number;
    messages: number;
    toolOutputs: number;
    knowledge: number;
    other: number;
  };
  truncatedItems: Array<{ type: string; id: string; originalTokens: number; keptTokens: number }>;
  offloadedItems: Array<{ type: string; id: string; target: 'disk' | 'summary' | 'dropped' }>;
  compactionTriggered: boolean;
  compactionLevel?: CompactionLevel;
}

// dashboard/types.ts

export interface HarnessDashboardData {
  knowledgeStats: {
    total: number;
    byType: Record<KnowledgeType, { total: number; proven: number; verified: number; draft: number }>;
    byLayer: Record<StorageLayer, number>;
    decaying: KnowledgeEntry[];
    recentlyPromoted: KnowledgeEntry[];
  };
  constraintStats: {
    byConstraint: Array<{
      id: string;
      triggerCount: number;
      passCount: number;
      blockCount: number;
      lastTriggered: string;
      trend: 'rising' | 'stable' | 'declining';
    }>;
    neverTriggered: string[];
    deprecatedProgress: Array<{
      id: string;
      currentLevel: 'error' | 'warning' | 'info';
      targetLevel: 'warning' | 'info' | 'removed';
      triggerCount30d: number;
    }>;
  };
  knowledgeFlow: {
    extracted: number;
    ingested: number;
    referenced: number;
    promoted: number;
    demoted: number;
    topReferenced: Array<{ id: string; title: string; refCount: number }>;
  };
  feedbackLoops: {
    local: { count: number; lastAt: string };
    push: { count: number; lastAt: string };
    external: { count: number; lastAt: string };
    flowedToKnowledge: number;
    pending: number;
  };
  contextHealth: {
    avgTokenUsage: number;
    compactionCount: number;
    truncationCount: number;
    offloadCount: number;
  };
}

// repl/types.ts

export interface HarnessREPLConfig {
  llm: LLMAdapter;
  knowledge: KnowledgeStore;
  context: ContextManager;
  tools: ToolRegistry;
}

export class HarnessREPL {
  constructor(config: HarnessREPLConfig);
  run(goal: string): Promise<HarnessResult>;
  checkConstraints(ctx: ConstraintContext): Promise<CheckResult>;
  queryKnowledge(budget: QueryBudget): Promise<QueryResult>;
}

export interface HarnessResult {
  success: boolean;
  output: string;
  constraintViolations: ConstraintViolation[];
  knowledgeUsed: KnowledgeReference[];
  contextSnapshot: ContextUsageSnapshot;
}

export interface LLMAdapter {
  chat(messages: Message[], options?: LLMOptions): Promise<string>;
  streamChat(messages: Message[], options?: LLMOptions): AsyncIterable<string>;
}

export interface KnowledgeStore {
  query(budget: QueryBudget): Promise<QueryResult>;
  ingest(entry: KnowledgeEntry): Promise<void>;
  lint(): Promise<LintIssue[]>;
}
```

### 10.7 现有模块改造

| 现有模块 | 改造 | 理由 |
|----------|------|------|
| `ConstraintChecker` | 保留，约束分为 safety/quality 两组 | safety 永久保留，quality 可退化 |
| `ConstraintDoctor` | 转型为 `KnowledgeDoctor`（重命名文件） | 从诊断约束异常 → 诊断知识库健康 |
| `ConstraintEvolver` | 转型为 `KnowledgeEvolver`（重命名文件） | 从进化约束规则 → 进化知识成熟度 |
| `TraceCollector` | 保留，新增知识引用追踪 | 追踪知识被使用的频率 |
| `ProgressiveLoader` | 保留，作为知识索引加载器 | 三级渐进式索引的基础设施 |
| `PassesGate` | 保留但降级为可选 | 测试质量约束，模型会自己做好 |
| `SessionStartup` | 增加知识注入步骤 | 启动时注入相关知识上下文 |
| `CleanStateManager` | 增加知识提取步骤 | 结束时提取新知识 |

### 10.8 对 workflow 和 runtime 的最终判定

**`@dommaker/workflows` 完全并入 harness**：
- `tools/` → harness 的 `tools/`（工具注册表）
- `workflows/` YAML → 重新定义为约束配置 + 工具清单声明
- `contexts/` → harness 的 `context/`（上下文模板）

**`@dommaker/runtime` 完全废弃**。所有有价值的功能迁入 harness：

| 原 runtime 模块 | 去向 |
|----------------|------|
| Agent 生命周期（spawn/monitor/fallback） | harness/agents/ |
| LLM 客户端 | harness/llm/ |
| 上下文管理（context/history/token） | harness/context/ |
| 质量保障（baseline/risk/root-cause） | harness/constraints/ |
| 内置工具（file/git/npm/shell） | harness/tools/core/ |
| 监控 | harness/monitoring/ |
| server/auth | harness/ |
| 业务逻辑（角色/治理/经济） | studio-* 包（已迁移） |

---

## 十一、实施路线

> 阶段依赖：Phase 1 是所有后续阶段的基础。Phase 2/3 可部分并行。Phase 4/5 依赖 Phase 1+2。Phase 6 依赖所有前置阶段。

### Phase 1：知识引擎核心（2-3 周）

**目标**：知识存储、查询、生命周期管理的基础能力。

```
1.1 定义知识类型系统 (knowledge/types.ts)
1.2 实现文件系统知识存储 (knowledge/store.ts)
1.3 实现三级索引构建 (knowledge/index-builder.ts)
1.4 实现带预算的知识查询 (knowledge/query.ts)
1.5 实现成熟度升降 + 自动衰减 (knowledge/lifecycle.ts)
1.6 测试用例
```

### Phase 2：上下文管理（2 周）

**目标**：文件读取/工具输出预算，Token 流水线，会话压缩。

```
2.1 实现文件读取预算 (context/file-budget.ts)
2.2 实现工具输出预算 (context/tool-output-budget.ts)
2.3 实现会话压缩三档策略 (context/compaction.ts)
2.4 实现 Token 流水线 (context/token-pipeline.ts)
2.5 实现上下文使用追踪 (monitoring/context-tracker.ts)
2.6 实现 session 解耦 (context/session-manager.ts)
2.7 测试用例
```

### Phase 3：引用追踪 + Lint（1-2 周）

**目标**：知识消费形成闭环，知识库可自我维护。

```
3.1 实现引用追踪 (knowledge/reference-tracker.ts)
3.2 实现知识库 Lint (knowledge/lint.ts)
3.3 实现知识注入 (context/knowledge-injector.ts)
3.4 测试用例
```

### Phase 4：安全护栏 + 验证（1-2 周）

**目标**：三层安全护栏 + 验证循环。

```
4.1 实现三层安全护栏 (safety/input-guardrail.ts, output-guardrail.ts, tool-guardrail.ts)
4.2 实现 Sandbox 策略 (safety/sandbox.ts)
4.3 实现规则验证 (verification/rules-based.ts)
4.4 实现验证循环编排 (verification/loop.ts)
4.5 测试用例
```

### Phase 5：约束系统重构 + 可视化（1-2 周）

**目标**：约束分层 + Dashboard 数据接口。

```
5.1 拆分 constraints/definitions.ts → safety.ts + quality.ts
5.2 给质量约束标记 deprecated-schedule
5.3 ConstraintDoctor → KnowledgeDoctor（重命名）
5.4 ConstraintEvolver → KnowledgeEvolver（重命名）
5.5 实现 Dashboard 数据聚合 (dashboard/data.ts)
5.6 测试用例
```

### Phase 6：冷启动 + 集成（2 周）

**目标**：历史项目知识导入，与 studio 集成，端到端上线。

```
6.1 实现冷启动导入 (knowledge/import.ts)
6.2 与 agents/ 模块集成（Agent 生命周期中的知识注入/提取）
6.3 与 studio 的项目管理集成
6.4 studio 侧实现 Harness Dashboard UI
6.5 端到端测试
```

### 实施优先级总览

| 优先级 | 阶段 | 周期 | 交付物 |
|--------|------|------|--------|
| **P0** | Phase 1: 知识引擎核心 | 2-3 周 | 知识存储/查询/生命周期 |
| **P0** | Phase 2: 上下文管理 | 2 周 | Token 流水线 + 预算 + 压缩 |
| **P1** | Phase 3: 引用追踪 + Lint | 1-2 周 | 知识闭环 + 自维护 |
| **P1** | Phase 4: 安全护栏 + 验证 | 1-2 周 | 三层护栏 + 验证循环 |
| **P2** | Phase 5: 约束重构 + 可视化 | 1-2 周 | 安全/质量分层 + Dashboard |
| **P2** | Phase 6: 冷启动 + 集成 | 2 周 | 端到端上线 |

总计约 **10-13 周**，最终产出：一个统一的 `@dommaker/harness` 包，以知识闭环为核心，替代原来的三个包。

### 转型成功标准

| 维度 | 指标 | 目标值 | 衡量方式 |
|------|------|--------|---------|
| 知识积累 | 知识库条目数 | ≥50 条 proven | 知识库查询 |
| 知识复用 | 知识命中率（任务执行中引用知识的比例） | ≥60% | 引用追踪 |
| 上下文效率 | 上下文利用率 | 60-80% | ContextUsageSnapshot |
| 自进化 | 约束提案自动执行率 | ≥30% 低风险提案 | Evolution Engine 日志 |
| 交付效率 | 同类任务交付时间缩短 | ≥20% | 任务耗时对比 |
| 安全 | Iron Law 违规率 | 0% | 约束追踪 |
| 系统健康 | 知识库 Lint 问题数 | ≤5 个/周 | Lint 报告 |

---

## 十二、Studio 适配

> harness 改造后，studio 需要从"三依赖模式"变为"单一依赖模式"。
> 本章从 harness 的新能力反推 studio 需要做什么适配。

### 12.1 依赖变更

```
之前：@dommaker/harness (约束) + @dommaker/runtime (执行) + @dommaker/workflows (工具)
之后：@dommaker/harness (唯一依赖)
```

| 包 | 当前依赖方式 | 改造后 |
|----|-------------|--------|
| studio-shared | TypeScript 导入 harness ~20 个导出 | 扩展为知识闭环接入层 |
| studio-meeting | 导入 9 个 Gate 类 + 错误/性能类型 | Gate 保留，新增知识查询 |
| studio-spec | 动态导入 harness | 保留 |
| studio-api | 直接导入 + HTTP 代理 runtime | 移除 runtime-proxy，直接调用 harness |
| 3 个脚本 | 导入约束/架构检查 | 保留 |
| task-worker | `require.resolve('@dommaker/workflows')` 找 shell 脚本 | 改为调用 harness/agents/ |
| tools-std 路由 | `require.resolve('@dommaker/workflows')` 找 YAML | 改为读取 harness/tools/ |
| outputs 路由 | `require.resolve('@dommaker/workflows')` 找输出目录 | 改为 harness 输出目录 |

### 12.2 runtime-proxy 模块改造

当前 `apps/api/src/modules/runtime-proxy/routes.ts` 代理 20+ 端点。runtime 废弃后分流：

| 端点类别 | 当前目标 | 改造后 | 说明 |
|----------|----------|--------|------|
| Iron Laws / Checkpoints | 已是本地 harness 调用 | **不变** | 44-329 行无需改动 |
| 工作流执行（execute, status, stop/pause/resume） | HTTP → runtime | 直接调用 harness/agents/ | spawn + monitor + fallback |
| 工具/技能列表（tools, skills） | HTTP → runtime | 读取 harness/tools/ | 从文件改为 API |
| 执行历史（executions） | HTTP → runtime | 读取 harness/monitoring/ | traces.jsonl |
| 配置（config） | HTTP → runtime | 本地配置 | 不再需要远程获取 |
| Spec 相关（reviews, analyze） | HTTP → runtime | 拆分：通用部分归 harness/spec/，业务部分归 studio-spec |
| 项目管理（projects） | HTTP → runtime | 本地管理 | studio 自己的项目表 |
| 文件浏览（files） | HTTP → runtime | 本地文件系统 | studio 直接读取 |

**改造策略**：渐进式迁移。先保留 proxy 作为兼容层，新功能直接调用 harness，逐步替换。

### 12.3 studio 新增能力

harness 新增了知识引擎、安全护栏、验证循环等能力，studio 需要提供对应的 UI 和配置：

| harness 能力 | studio 适配 | 优先级 |
|-------------|------------|--------|
| knowledge/*（知识引擎） | 知识库浏览/搜索/贡献 UI | P0 |
| knowledge/import（冷启动） | 项目首次接入的导入向导 | P0 |
| dashboard/*（数据聚合） | Dashboard 四视图 UI | P1 |
| conflicts/（冲突裁决） | maintainer 裁决界面 | P1 |
| llm/adapter（LLM 适配器） | 模型选择 + API Key 管理配置 | P0 |
| safety/sandbox（沙箱级别） | Sandbox 级别配置（默认 Level 2） | P2 |
| context/knowledge-injector | 各阶段查询预算和类型过滤配置 | P2 |
| verification/*（验证循环） | 验证规则配置（哪些验证开启/关闭） | P3 |
| constraints/quality（可退化约束） | 约束退化审批界面 | P3 |

### 12.4 studio-shared wrapper 升级

当前 `studio-shared/src/harness/index.ts` 是约束框架的包装器。需要升级为知识闭环接入层：

```typescript
// 当前导出（约束框架）
export { constraintChecker, checkConstraint, getAllConstraints, ... }
export { IRON_LAWS, GUIDELINES, TIPS }
export { CheckpointValidator }
export { ConstraintService, CheckpointService }

// 新增导出（知识闭环）
export { KnowledgeEngine }          // 知识查询/存储
export { KnowledgeInjector }        // 知识注入 Agent 上下文
export { ReferenceTracker }         // 引用追踪
export { KnowledgeLifecycle }       // 成熟度升降
export { HarnessDashboardData }     // Dashboard 数据接口
export { LLMAdapter }               // LLM 适配器接口
export { SandboxLevel }             // 安全级别
```

现有约束相关导出保留（向后兼容），新增知识相关导出。

### 12.5 studio 新增 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/knowledge` | GET | 知识库列表（分页、过滤） |
| `/api/v1/knowledge/:id` | GET | 知识条目详情 |
| `/api/v1/knowledge/search` | GET | 知识搜索（语义 + 关键词） |
| `/api/v1/knowledge/stats` | GET | 知识库统计（Dashboard 视图一） |
| `/api/v1/knowledge/import` | POST | 触发冷启动导入 |
| `/api/v1/knowledge/conflicts` | GET | 待裁决冲突列表 |
| `/api/v1/knowledge/conflicts/:id` | PUT | 裁决冲突 |
| `/api/v1/dashboard/constraints` | GET | 约束执行统计（Dashboard 视图二） |
| `/api/v1/dashboard/flow` | GET | 知识流转统计（Dashboard 视图三） |
| `/api/v1/dashboard/feedback` | GET | 反馈环状态（Dashboard 视图四） |
| `/api/v1/dashboard/context` | GET | 上下文健康指标 |
| `/api/v1/agents` | GET | Agent 列表（替代 runtime 的 /executions） |
| `/api/v1/agents/:id` | GET | Agent 执行状态 |
| `/api/v1/agents/:id/stop` | POST | 停止 Agent |
| `/api/v1/config/llm` | GET/PUT | LLM 模型配置 |
| `/api/v1/config/sandbox` | GET/PUT | Sandbox 级别配置 |

**知识搜索实现：** 关键词搜索用 PostgreSQL `full_text_search`（`tsvector` + `tsquery`），语义搜索用 `pgvector` 扩展（embedding 维度 1536，模型 `text-embedding-3-small`）。两种结果按加权分合并（关键词 0.4 + 语义 0.6），返回 top-K 条目。搜索仅覆盖 Layer 1/2/3 活跃条目（`maturity != 'archived'`）。

### 12.6 前端新增页面

| 页面 | 路由 | 说明 |
|------|------|------|
| 知识库 | `/knowledge` | 浏览/搜索/筛选知识条目 |
| 知识详情 | `/knowledge/:id` | 条目详情 + 引用历史 + 成熟度时间线 |
| Dashboard | `/dashboard` | 四个视图的聚合页 |
| 冷启动向导 | `/knowledge/import` | 项目首次接入引导 |
| 冲突裁决 | `/knowledge/conflicts` | maintainer 裁决界面 |
| 约束管理 | `/constraints` | 约束列表 + 退化状态 + 拦截率趋势 |
| LLM 配置 | `/settings/llm` | 模型选择、API Key、fallback 配置 |

### 12.7 studio 改造优先级

| 阶段 | 改造内容 | 依赖 harness 阶段 | 周期 |
|------|----------|-------------------|------|
| **S1** | 依赖切换（三包→一包）+ studio-shared wrapper 升级 | Phase 1 完成后 | 1 周 |
| **S2** | LLM 配置 + 冷启动向导 + 知识库基础 UI | Phase 1+2 完成后 | 2 周 |
| **S3** | runtime-proxy 逐步替换（新功能直接调用 harness） | Phase 1-3 完成后 | 2 周 |
| **S4** | Dashboard UI + 冲突裁决界面 | Phase 4-5 完成后 | 1-2 周 |
| **S5** | 剩余端点迁移 + runtime-proxy 下线 | Phase 6 完成后 | 1 周 |

总计约 **7-8 周**（与 harness 改造部分并行）。

### 12.8 Studio 自身优化（独立于 harness 适配）

除了适配新 harness 之外，studio 自身有以下需要修复和优化的问题。

#### 安全问题（必须修）

| # | 问题 | 位置 | 严重度 |
|---|------|------|--------|
| 1 | 硬编码 API Key | `apps/api/src/modules/llm/client.ts:29` | **P0**（修复方案见 12.11） |
| 2 | `source: 'api'` 绕过权限检查（任意客户端可提权） | `middleware/permission-check.ts:22` | **P0** |
| 3 | Shell 注入风险（`escapePrompt()` 不处理反引号/分号/管道符） | `workers/task-worker.ts:148` | **P0** |
| 4 | 13 个路由模块无认证中间件（含 tasks、knowledge 等写操作） | 多个 modules | **P1** |

#### 数据库问题

| # | 问题 | 改动 |
|---|------|------|
| 5 | 4 个独立 PrismaClient 实例（auth/tasks/auth-service/knowledge 各自 new） | 统一用 `core/database.ts` 单例 |

#### 架构债务

| # | 问题 | 改动 |
|---|------|------|
| 6 | `meetings/routes.ts` 2079 行 god file（路由+LLM+Redis+权限+文件 I/O） | 拆分为 service + controller + route |
| 7 | `notifications` vs `notify` 两个重复模块 | 合并为一个 |
| 8 | `studio-review`（820行）+ `studio-review-core`（513行）两个小包 | 合并 |
| 9 | `studio-shared` barrel 导出 CLI 代码给所有消费者 | 拆分子 barrel |
| 10 | 路由注册是手动列表（app.ts 30+ 行 `app.use()`） | 改为模块化注册 |

#### 前端问题

| # | 问题 | 改动 |
|---|------|------|
| 11 | `App.tsx` 656 行（路由+WebSocket+8 个 handler+16 个 prop） | 提取 hooks，拆分组件 |
| 12 | 两个 editor store 重复定义 `Position/Node/Edge` 类型 | 共享类型定义 |
| 13 | `authStore` 用原生 `fetch` 绕过 axios 拦截器 | 统一用 API client |
| 14 | 无 Zustand persist，token 手动同步 localStorage | 加 persist 中间件 |
| 15 | `useAppStore` 混合 agents/workflows/executions/UI 状态 | 拆分为独立 stores |

#### 性能问题

| # | 问题 | 改动 |
|---|------|------|
| 16 | task-worker 1 秒轮询（`while` + `sleep`） | 改为 Redis BLPOP 或 BullMQ 事件驱动 |
| 17 | task-worker 无并发控制（单任务串行） | 加并发配置 |

#### Workflow 模式落伍：核心架构转型

Studio 当前是 **"人驱动、AI 辅助"** 模型——人发起需求、开会讨论、拆任务、分配给 AI 角色执行。编排逻辑是硬编码的 workflow，本质上和传统 CI/CD pipeline 没区别，只是把 shell 换成了 LLM 调用。

这个模式正在被淘汰。大模型快速进化（如 kimi k2.6），已经可以通过 Claw 群组搭建一人公司、数百个 agent 并行、自主规划自主执行自主迭代。**硬编码 workflow 对比自主 Agent 是降维打击。**

Studio 的定位必须转型：

```
现在：AI 协作的项目管理平台（人管理 AI 做事）
未来：AI Agent 的操作系统（给 AI 提供基础设施）
```

核心转变：
- 不是 "管理 AI 做事"，是 "给 AI 提供基础设施"
- 不是 "人定义流程"，是 "人定义目标和约束"
- 不是 "固定角色"，是 "动态 Agent 团队"
- 不是 "执行完就结束"，是 "执行完沉淀经验"

##### Runtime 价值判定

| 组件 | 命运 | 理由 |
|------|------|------|
| executor / parser / registry / state | **删除** | 工作流编排引擎，Agent 自主规划替代 |
| spawn / agent-fallback / progress-parser | **保留增强** | Agent 生命周期管理，运行时基础设施 |
| context / history-compressor / token-tracker | **保留增强** | 上下文管理，需增加记忆层 |
| baseline-validator / risk-assessor / root-cause-analyzer | **保留增强** | 质量保障，核心护城河 |
| builtin-handlers (file/git/npm/shell) | **保留** | Agent 需要可靠工具 |
| server / auth / llm-client / monitoring | **保留升级** | 基础设施，llm-client 升级为模型网关 |
| 20 个 workflow YAML | **删除** | Goal 驱动替代硬编码流程 |
| 113 个 tool YAML | **保留增强** | 工具契约，加入使用经验和约束 |

##### 转型路径

```
Runtime：从 "工作流执行引擎" → "Agent 运行时环境"
Workflow：从 "流程定义 + 工具定义" → "工具注册表 + 技能库"
```

具体改造：

| # | 方向 | 内容 | 来源 |
|---|------|------|------|
| 18 | 持久化记忆 | Redis（短期）+ Postgres+Vector（中期）+ RAG（长期） | agent-native 文档 §二 |
| 19 | 会议纪要持久化 | 当前 Redis 24h 过期，决策理由丢失 | agent-native 文档 §二 |
| 20 | Skill 自动沉淀 | 从执行历史中提炼可复用能力，Skill 不是人写的，是 Agent 从执行中自动提炼的 | agent-native 文档 §三 |
| 21 | 模型网关 | 统一 LLM 调用、用量统计、Fallback（harness llm/ 提供基础） | agent-native 文档 §四 |
| 22 | **Goal 驱动替代 Workflow** | Agent 自主规划替代硬编码流程，人只定义目标和约束 | agent-native 文档 §五 |

#22 是架构级改造（预估 4-6 周），依赖 #18-21 基础设施就绪后实施。

#### 优化优先级总览

| 阶段 | 内容 | 周期 |
|------|------|------|
| **O1** | 安全修复（#1-4）+ PrismaClient 统一（#5） | 1 周 |
| **O2** | meetings god file 拆分（#6）+ 前端 App.tsx 拆分（#11） | 2 周 |
| **O3** | 模块合并（#7-8）+ barrel 拆分（#9）+ 前端 stores 重构（#12-15） | 1-2 周 |
| **O4** | task-worker 性能优化（#16-17）+ 路由注册改造（#10） | 1 周 |
| **O5** | Agent-Native 基础设施（#18-21：记忆+Skill+模型网关） | 与 harness 改造并行 |
| **O6** | Goal 驱动架构（#22：workflow→goal，runtime→agent runtime） | O5 完成后，4-6 周 |

O1 应在 harness 适配之前完成（安全不能等）。O2-O4 可与 harness 适配（S1-S5）并行。O5 依赖 harness 知识引擎就绪。O6 是 Studio 的终极形态转型，依赖 O5 全部完成。

### 12.9 系统能力 MCP 化：UI 和 Agent 共享同一套后端

Studio 当前是人类操作的 UI 界面——人点按钮 → REST API → 后端模块。底层实现需要更偏 agent：系统能力拆分为 MCP tools，人和 agent 共享同一套后端。

#### 12.9.1 核心架构

```
┌──────────────────────────────────────────────────────────────┐
│                       Studio 后端                             │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ meeting     │  │ task        │  │ knowledge   │  ...     │
│  │ module      │  │ module      │  │ module      │          │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│         │                │                │                  │
│         └────────────────┼────────────────┘                  │
│                          │                                    │
│                    MCP Server                                 │
│                    （所有模块暴露为 tools）                     │
│                          │                                    │
│              ┌───────────┼───────────┐                        │
│              ▼           ▼           ▼                        │
│         ┌────────┐ ┌──────────┐ ┌─────────┐                 │
│         │ UI API │ │Orchestr. │ │ 外部    │                 │
│         │ (REST) │ │Agent     │ │ Agent   │                 │
│         └────────┘ └──────────┘ └─────────┘                 │
│              │           │           │                        │
│              ▼           ▼           ▼                        │
│          人操作UI    Claude Code   Codex/                     │
│                      (会议主Agent) OpenCode                   │
└──────────────────────────────────────────────────────────────┘
```

**人通过 UI 操作和 Agent 通过 MCP 调用，走的是同一套后端代码。** 不会出现 UI 一套逻辑、Agent 一套逻辑的分裂。

#### 12.9.2 模块→MCP tools 映射

| Studio 模块 | 暴露的 MCP tools | 说明 |
|------------|-----------------|------|
| `studio-meeting` | `startDiscussion`, `sendMessage`, `checkConsensus`, `injectDevilsAdvocate`, `extractDecision`, `endMeeting` | 会议全流程 |
| `studio-task` | `createTask`, `assignTask`, `updateStatus`, `getTaskBoard`, `splitTasks` | 任务管理 |
| `studio-role` | `listRoles`, `getRoleMemory`, `updateSkill`, `getRoleHistory` | 角色和记忆 |
| `studio-economy` | `getBalance`, `settleSalary`, `getTransactionHistory` | 经济系统 |
| `studio-knowledge` | `queryKnowledge`, `extractKnowledge`, `lintKnowledge`, `getMaturity` | 知识引擎 |
| `studio-spec` | `createSpec`, `reviewSpec`, `approveSpec`, `getSpecStatus` | Spec 审批 |
| `studio-pmo` | `createProject`, `getProjectStatus`, `listProjects`, `updateProject` | 项目管理 |
| `studio-workflow` | `listTools`, `getToolSchema`, `getToolUsageStats` | 工具注册表（流程定义已删除） |
| `studio-agent` | `spawnAgent`, `getAgentStatus`, `stopAgent`, `getAgentResult` | Agent 调度 |
| harness `safety/` | `checkConstraint`, `checkGuardrail`, `getSandboxLevel` | 安全约束 |
| harness `gates/` | `runGateCheck`, `getVerificationResult` | 质量门禁 |
| harness `knowledge/` | `storeKnowledge`, `searchKnowledge`, `getKnowledgeStats` | 知识存储 |

每个 MCP tool 有明确的 input/output schema：

```typescript
// 示例：startDiscussion tool
{
  name: "startDiscussion",
  description: "在 PMO 项目会议中发起一个议题讨论",
  inputSchema: {
    type: "object",
    properties: {
      meetingId: { type: "string", description: "PMO 会议 ID" },
      topic: { type: "string", description: "议题内容" },
      roles: {
        type: "array",
        items: { type: "string", enum: ["advocate","skeptic","architect","pragmatist","executor","reviewer","visionary","neutral"] },
        description: "参与讨论的角色及其立场"
      }
    },
    required: ["meetingId", "topic", "roles"]
  },
  outputSchema: {
    type: "object",
    properties: {
      discussionId: { type: "string" },
      messages: { type: "array", items: { type: "object" } },
      consensusStatus: { type: "string", enum: ["unanimous", "majority", "divided", "pending"] }
    }
  }
}
```

#### 12.9.3 Orchestrator 的工具列表 = Studio 的系统能力

Orchestrator Agent 启动时，加载所有 Studio MCP tools：

```
Orchestrator 启动 prompt：
  "你是项目 {projectName} 的 Orchestrator。
   你的职责：管理项目会议，协调讨论，监督执行，沉淀知识。
   你可以使用以下工具：
   - startDiscussion(topic, roles)     发起讨论
   - checkConsensus(messages)          检查共识
   - injectDevilsAdvocate(messages)    注入反对意见
   - extractDecision(messages)         提取结构化决策
   - planExecution(decision)           拆分执行计划
   - spawnAgent(task, agentType)       召唤编码 agent
   - verifyResult(result, decision)    验证结果
   - extractKnowledge(results)         提取知识
   - queryKnowledge(query)             查询知识库
   - createTask(task)                  创建任务
   - getProjectStatus()                查看项目状态
   ..."
```

**这些工具不是新造的，是 Studio 现有后端能力的 MCP 封装。** Orchestrator 调 `startDiscussion`，背后就是 `studio-meeting` 模块在执行。

#### 12.9.4 UI 保留，但从"操作者"变为"观察者+审批者"

```
当前 UI 流程（人驱动）：
  人点击"创建会议" → API → meeting module → 返回会议页面
  人点击"开始讨论" → API → discussion-driver → 返回讨论消息
  人点击"分配任务" → API → task module → 返回任务列表

未来 UI 流程（Agent 驱动，人观察+审批）：
  人点击"创建项目" → API → pmo module → Orchestrator Agent 启动
                                         → Agent 自动发起讨论
                                         → 人可以看到实时讨论进展
                                         → Agent 自动达成共识
                                         → 人审批决策（或自动通过）
                                         → Agent 自动拆任务+执行
                                         → 人观察执行进度
                                         → Agent 完成，人查看结果
```

UI 的角色变化：

| 维度 | 当前 | 未来 |
|------|------|------|
| 人做什么 | 点按钮推动每个步骤 | 定义目标，观察进展，审批关键决策 |
| UI 展示什么 | 表单、按钮、操作面板 | 实时进展、决策摘要、审批队列 |
| 后端由谁调用 | 人通过 UI 调用 | Agent 通过 MCP 调用 + 人通过 UI 调用 |
| 阻塞点 | 人不操作就卡住 | Agent 自主执行，只在关键节点等人 |

#### 12.9.5 实现路径

```
Phase 1: 模块 MCP 化（基础工作，2-3 周）
  - 每个 studio-* 包暴露 MCP tool 接口
  - 注册到统一的 MCP Server
  - REST API 改为调用 MCP tools（统一底层，两个入口）
  - 现有 UI 功能不受影响

**MCP Server 实现：** 使用 `@modelcontextprotocol/sdk`，stdio 传输（Orchestrator 本地 spawn）+ SSE 传输（远程 Sub-agent）。Tool schema 用 JSON Schema 定义，从各 studio-* 包的 TypeScript 接口自动生成。版本管理跟随各包版本，MCP Server 启动时扫描所有已注册 tools 并校验 schema 一致性。

Phase 2: Orchestrator Agent 接入（依赖 Phase 1 + harness 知识引擎）
  - Orchestrator 启动时加载所有 MCP tools
  - Orchestrator 在会议中调用 tools 驱动全流程
  - UI 增加"Agent 驱动模式"开关
  - 人可以选择"自己操作"或"让 Agent 驱动"

Phase 3: Agent 自主行为（远期）
  - Agent 订阅项目事件，主动发起议题
  - Agent 主动发现问题，主动发言
  - 人从"推动者"变成"监督者"
```

#### 12.9.6 与 12.10 会议系统的关系

本节（12.9）是**基础设施**——把系统能力拆成 MCP tools。
下一节（12.10）是**上层应用**——用这些 tools 驱动会议流程。

```
12.9 系统能力 MCP 化：底层能力拆分，UI 和 Agent 共享
  ↓ 提供基础设施
12.10 会议系统改造：用 MCP tools 实现 Orchestrator → Discussion → Execution → Knowledge
```

没有 12.9 的 MCP 化，12.10 的 Orchestrator 就没有工具可用。没有 12.10 的会议系统，12.9 的 MCP tools 就没有编排者。

### 12.10 会议系统改造 + Agent 统一调度

本节将会议持久化、Agent 统一调度、角色知识沉淀三条线串成完整流程。

#### 12.10.1 会议持久化：叠 PMO，不造新概念

不引入"频道"新概念。保留"会议"，叠 PMO 系统做持久化——本质是"项目会议"，生命周期 = 项目生命周期。

```
当前：创建会议 → 多轮讨论 → 生成纪要 → 会议结束（Redis 24h 过期）
改后：PMO Project Meeting → 多轮讨论 → 决策 → 执行 → 知识沉淀（PostgreSQL 持久化）
```

数据模型变更：

| 变更 | 说明 |
|------|------|
| `Meeting` 加 `projectId` 外键 | 关联 PMO Project，生命周期绑定 |
| `Message` 从 Redis 迁到 PostgreSQL | 持久化存储，可查询可关联 |
| `Topic` 模型 | 会议内的议题线程（一个项目会议可有多个议题） |
| `AgentSubscription` 模型 | Agent 订阅感兴趣的议题类型 |

用户看到的是"项目会议"，PMO 的看板、统计、权限体系直接复用。不需要发明新东西。

#### 12.10.2 三层 Agent 架构

当前 agent 调用是割裂的：

| 层 | 位置 | 状态 |
|---|---|---|
| runtime spawn | `agent-platform/runtime/src/executors/spawn.ts` | 能用，只支持 Codex + Claude Code |
| runtime fallback | `agent-platform/runtime/src/core/agent-fallback.ts` | 名字互换，无智能降级 |
| studio task-worker | `studio/apps/api/src/workers/task-worker.ts` | **坏的**，引用不存在的 `run-task.sh` |
| studio agent-executor | `studio/packages/studio-agent/src/services/agent-executor.ts` | 完整但没接入，孤立实现 |

统一为三层架构：Orchestrator → DB → AgentRouter → Sub-agent。

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: Orchestrator Agent（Claude Code，持久进程）          │
│  - 每个 PMO 项目会议一个 Orchestrator 实例                     │
│  - 200K 上下文，记住整个会议的所有 Topic 和决策                │
│  - 职责：讨论、规划、验证、知识提取                            │
│  - 不能直接 spawn Codex/OpenCode（Claude Code 只能 spawn      │
│    自己的 SubAgent），通过 DB 与执行层通信                      │
└──────────────────────┬───────────────────────────────────────┘
                       │ 写 ExecutionPlan → DB
                       │ 读 ExecutionResult ← DB
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  PostgreSQL（通信介质）                                        │
│  - execution_plans：Orchestrator 写，AgentRouter 读           │
│  - execution_results：AgentRouter 写，Orchestrator 读         │
└──────────────────────┬───────────────────────────────────────┘
                       │ 读计划，写结果
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 2: AgentRouter（Studio API 服务内）                     │
│  - 纯执行层，不感知业务逻辑                                    │
│  - 路由策略：任务类型 → agent 能力匹配                         │
│  - 优先级链：claude-code > codex > opencode                   │
│  - Fallback：crash → 换 agent + 注入错误信息                   │
│  - 并行 spawn 多个子任务                                       │
│  - 规则验证（tsc/lint/test）在这一层做                         │
└──────────────────────┬───────────────────────────────────────┘
                       │ spawn CLI
            ┌──────────┼──────────┐
            ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  Codex   │ │ Claude   │ │ OpenCode │
│  Agent   │ │ Code     │ │ Agent    │
│  Adapter │ │ Adapter  │ │ Adapter  │
└────┬─────┘ └────┬─────┘ └────┬─────┘
     │            │            │
     ▼            ▼            ▼
  codex CLI   claude CLI   opencode CLI
  子进程spawn  子进程spawn  子进程spawn
     │            │            │
     └────────────┼────────────┘
                  ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 3: Sub-agent（无状态，每次 spawn 独立进程）              │
│  - 不知道会议上下文，只知道自己的任务 + 验收标准               │
│  - 在 worktree 隔离环境中执行（sandbox 级别 2）               │
│  - 输出结构化 JSON（不是自然语言）                             │
│  - 执行完退出，不保留状态                                      │
└──────────────────────────────────────────────────────────────┘
```

**为什么分三层而不是 Orchestrator 直接 spawn？**

| 维度 | 直接 spawn | DB 解耦（采用） |
|------|-----------|----------------|
| 并行 | 难，Bash 是串行的 | 容易，AgentRouter 并行 spawn |
| 上下文隔离 | 子 agent 输出混入 Orchestrator 对话 | 通过 DB 隔离，Orchestrator 只看摘要 |
| 资源管理 | 所有进程都在 Claude Code shell 下 | 执行层独立管理进程生命周期 |
| 错误处理 | Orchestrator 自己处理 | AgentRouter 有独立的重试/超时机制 |

**三个 Agent 的具体调用方式：**

```typescript
// Codex（已有，微调）
spawn('codex', ['exec', '--full-auto', '--skip-git-repo-check', prompt], {
  cwd: workdir, timeout: 600_000
})

// Claude Code（已有，微调）
// root → Docker, 非 root → CLI
spawn('claude', ['--print', '--permission-mode', 'bypassPermissions', prompt], {
  cwd: workdir, env: { ANTHROPIC_API_KEY }
})

// OpenCode（新增）
spawn('opencode', ['--prompt', prompt, '--directory', workdir, '--non-interactive'], {
  cwd: workdir, timeout: 600_000
})
```

统一接口（由 harness 的 `llm/adapter.ts` 提供）：

```typescript
interface AgentAdapter {
  name: string
  capabilities: AgentCapability[]  // code / test / review / plan

  invoke(params: {
    prompt: string           // 精简 prompt，300-500 tokens
    workdir: string          // worktree 隔离
    timeout?: number
  }): Promise<AgentResult>

  healthCheck(): Promise<boolean>
}

interface AgentResult {
  exitCode: number
  filesChanged: string[]
  testsPassed: boolean
  lintPassed: boolean          // lint 检查结果
  selfRetries: number          // 自重试次数
  failureLog: {                // 每次失败的记录，进化的原材料
    attempt: number
    error: string              // 错误信息
    rootCause: string          // 根因分析
    fix: string                // 修复方式
  }[]
  duration: number
  notes: string
}
```

**上下文传递的 Token 控制：**

多层传递最大的风险是 token 浪费和噪音。通过分层压缩解决：

```
Orchestrator 层（全量上下文）:
  会议全貌 + 所有 Topic 摘要 + 当前决策 + 角色记忆 + 知识
  ~6000 tokens，但不会膨胀——每个 Topic 完成后压缩为 1 行摘要

Orchestrator → DB（ExecutionPlan，精简）:
  每个子任务：决策 + 验收标准 + 约束 + 已知陷阱 + 相关文件
  ~400 tokens / 任务，只包含"做什么 + 怎么算做对了"

DB → Sub-agent（prompt，最精简）:
  任务描述 + 验收标准 + 约束 + 陷阱
  ~300-500 tokens，不注入会议历史、不注入完整知识库

Sub-agent → DB（AgentResult，结构化）:
  JSON: { files, testsPassed, structuredOutput }
  ~200 tokens，不是自然语言输出

DB → Orchestrator（结果摘要）:
  每个任务：通过/失败 + 变更文件 + 偏差列表
  ~100 tokens / 任务
```

单次 Topic 的 token 消耗对比：

| 环节 | 旧设计 | 新设计 | 节省 |
|------|--------|--------|------|
| 子 agent prompt | ~2500 tokens | ~400 tokens | 84% |
| 子 agent 输出 | ~2000 tokens | ~200 tokens | 90% |
| Orchestrator 读结果 | ~6000 tokens | ~600 tokens | 90% |
| 单次 Topic 总传递 | ~20000 tokens | ~3000 tokens | 85% |

**核心原则：子 agent 不需要知道"为什么这么做"（Orchestrator 的事），只需要知道"做什么 + 怎么算做对了"。**

**Tools 作为 MCP Server 暴露给 Sub-agent：**

现有 113 个 workflow tools（file-read, git-commit, npm-run 等）是原子操作，不是 agent。这些 tools 在新架构里需要暴露给 sub-agent 使用。方式是注册为 MCP Server：

```
┌──────────────────────────────────────────────────────────────┐
│  MCP Server（Studio Tools）                                   │
│                                                              │
│  113 个 tools → 注册为 MCP 工具                               │
│                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ file-read   │ │ git-commit  │ │ npm-run     │  ...       │
│  │ (带约束校验) │ │ (带审计日志) │ │ (带覆盖率)  │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                              │
│  暴露方式：stdio 或 SSE                                       │
│  Sub-agent 通过 MCP 协议调用，与内置工具无感知切换             │
└──────────────────────────────────────────────────────────────┘
```

Sub-agent（无论 Codex、Claude Code 还是 OpenCode）spawn 时，AgentRouter 根据 ExecutionPlan 中的 `requiredTools` 字段配置 MCP Server：

```typescript
interface ExecutionTask {
  id: string
  agent: 'codex' | 'claude-code' | 'opencode'
  prompt: string
  workdir: string
  requiredTools: string[]   // ← 新增：该任务需要的 tools
  acceptanceCriteria: string[]
  timeout: number
}
```

spawn 时注入 MCP 配置：

```
AgentRouter spawn sub-agent:
  - prompt: "实现 auth middleware"
  - workdir: worktree-abc123
  - mcpServers: {
      "studio-tools": {
        command: "npx",
        args: ["@dommaker/studio-tools-mcp"],
        env: { DATABASE_URL: "..." }
      }
    }
```

Sub-agent 执行时混合使用内置工具和 MCP 工具：

```
Sub-agent 执行流程：
  1. file-read auth.ts          ← 内置工具（读现有代码）
  2. file-write auth.ts         ← MCP 工具（带约束校验：不能写 .env）
  3. npm-run test               ← MCP 工具（带覆盖率检查）
  4. git-commit                 ← MCP 工具（带审计日志）
```

**Orchestrator 在 Planning 阶段决定每个任务需要哪些 tools：**

```
Orchestrator 分析决策：
  "实现 JWT 认证"
  → 需要：file-write（写代码）, npm-run（跑测试）, git-commit（提交）
  → 不需要：npm-publish, docker-build, deploy

  写入 ExecutionPlan:
  {
    task: "实现 auth middleware",
    requiredTools: ["file-write", "npm-run", "git-commit"],
    ...
  }
```

**Tools 的使用经验自动沉淀为知识：**

```
git-commit 在 50 次执行中：
  - 47 次成功
  - 3 次失败（原因：没带 -m 参数）
  → 沉淀 pitfall: "git-commit 必须带 message 参数"
  → 下次 spawn 时注入 prompt: "注意：git-commit 必须带 -m 参数"
```

#### 12.10.3 角色知识沉淀：外部记忆注入

Agent 进程本身无状态（spawn → 执行 → 退出），但**记忆存在外部知识库**。

```
┌─────────────────────────────────────────────┐
│          角色记忆库（knowledge engine）        │
│                                              │
│  Developer 角色                              │
│  ├── 执行历史：50 次任务的输入/输出/结果       │
│  ├── Skill 库：implement-rest-api（自动提炼） │
│  ├── Pitfall 库：Redis 并发锁的 3 个坑        │
│  └── 偏好：Express > Koa, vitest > jest       │
│                                              │
│  Architect 角色                              │
│  ├── 决策历史：30 个架构决策及理由             │
│  └── 模式库：微服务拆分的 5 种 pattern        │
│                                              │
│  存储：PostgreSQL + Vector                   │
│  来源：每次执行后自动提取（ARCHIVE 阶段）      │
└─────────────────────────────────────────────┘
```

Agent spawn 时，通过 token pipeline（§5.3）注入角色记忆：

```
角色记忆 → Token Pipeline（收集→排序→压缩→预算→组装）→ 注入 prompt
```

这样 agent 虽然每次都是无状态 spawn，但每次启动时都带着角色的全部经验。**记忆不在 agent 里，在知识库里。**

#### 12.10.4 完整流程串接

```
┌─────────────────────────────────────────────────────────────────┐
│  Orchestrator Agent (Claude Code，持久进程)                       │
│  启动时：queryKnowledge(项目相关) → 注入相关知识（含上次 ARCHIVE 产出）│
│  上下文：项目目标 + Topic 摘要 + 当前决策 + 知识（~6000 tokens）   │
│                                                                  │
│  ┌─ Topic 1: "用户认证方案" ─────────────────────────────────┐  │
│  │                                                           │  │
│  │  ① DISCUSSION: Orchestrator 内部模拟 stance 辩论          │  │
│  │     - 调 LLM API 模拟 advocate/skeptic/architect 等       │  │
│  │     - 每 3 轮检查共识，opposition < 10% 注入 Devil's Adv. │  │
│  │     - 共识达成 → 提取 StructuredDecision                  │  │
│  │                    ↓                                       │  │
│  │                                                           │  │
│  │  ② PLANNING: Orchestrator 拆分执行计划                    │  │
│  │     - 分析决策 scope（single_file / module / project）     │  │
│  │     - 拆成子任务，确定依赖关系                              │  │
│  │     - 每个任务：精简 prompt（~400 tokens）+ 验收标准       │  │
│  │     - 写 ExecutionPlan → PostgreSQL                       │  │
│  │                    ↓                                       │  │
│  │                                                           │  │
│  │  ③ EXECUTION: AgentRouter spawn 子 agent                   │  │
│  │     - AgentRouter 选择 agent + 配置 MCP Server             │  │
│  │     - spawn 子进程，worktree 隔离（sandbox 级别 3）        │  │
│  │     - 子 agent 自己写代码 + 自己跑 tsc/test/lint           │  │
│  │     - 子 agent 自己修 bug + 自己重试（最多 3 次）          │  │
│  │     - 通过后输出精简 JSON（~200 tokens）                   │  │
│  │     - AgentRouter 做 sanity check（抽查 tsc 通过）         │  │
│  │     - 汇总所有子任务 → ExecutionSummary → PostgreSQL       │  │
│  │                    ↓                                       │  │
│  │                                                           │  │
│  │  ④ VERIFY: Orchestrator 只做语义验证                       │  │
│  │     - 读 ExecutionSummary（ALL_PASS / PARTIAL / FAIL）     │  │
│  │     - ALL_PASS → LLM 裁判批量验证所有验收标准              │  │
│  │     - PARTIAL/FAIL → 注入偏差 → 重新 spawn（最多 2 次）    │  │
│  │     - 连续 3 次 Orchestrator 重试失败 → 通知人工           │  │
│  │                    ↓                                       │  │
│  │                                                           │  │
│  │  ⑤ WRITEBACK: 结果回写 Topic                              │  │
│  │     - 执行结果 + 验证结果 + 偏差列表 → Topic 消息         │  │
│  │     - Topic 1 完成 → 压缩为 1 行摘要存入 Orchestrator 记忆 │  │
│  │                    ↓                                       │  │
│  │                                                           │  │
│  │  ⑥ ARCHIVE: 知识提取 + 角色经验写入                       │  │
│  │     - 决策 → decision 类型知识条目 → 写入知识库            │  │
│  │     - 踩坑 → pitfall 类型知识条目 → 写入知识库            │  │
│  │     - 经验 → guideline 类型知识条目 → 写入知识库           │  │
│  │     - 成熟度判定（draft → verified → proven）             │  │
│  │     - ExecutionSummary → RoleExperience 记录写入 DB       │  │
│  │       { roleId, taskType, outcome, failureLog, duration } │  │
│  │     - 下次 Orchestrator PLANNING 时可查询角色经验         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ Topic 2: "数据库迁移方案" ── ... ───────────────────────┐  │
│  │  Orchestrator 记得 Topic 1 的摘要，上下文不膨胀            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### 12.10.5 决策→规划→执行→验证→回写 详解

这是整个流程中最关键的环节。分为两条流水线：**Orchestrator 流水线**（规划+验证）和 **AgentRouter 流水线**（执行），通过 PostgreSQL 解耦。

**通信机制：** AgentRouter 通过 PostgreSQL LISTEN/NOTIFY 监听 ExecutionPlan 变更（延迟 <100ms），而非轮询。Orchestrator 写入 ExecutionPlan 后执行 `NOTIFY execution_plan_channel`，AgentRouter 收到通知后立即读取。DB 不可用时，AgentRouter 降级为 5s 间隔轮询，Orchestrator 侧写入失败则重试 3 次后报错。

##### ② PLANNING：Orchestrator 拆分执行计划

决策本身是自然语言。Orchestrator 的第一项工作是把它翻译成可验证的执行计划。

```typescript
interface StructuredDecision {
  content: string           // "使用 JWT + refresh token 方案"
  rationale: string         // "无状态，适合分布式部署"
  confidence: number        // 0-1
  acceptanceCriteria: string[]  // 可机器验证的条件列表
  constraints: string[]     // 不可协商的约束
  knowledgeReferences: string[]
  scope: 'single_file' | 'multi_file' | 'module' | 'project'
}

interface ExecutionPlan {
  decisionId: string
  tasks: ExecutionTask[]    // 子任务列表
  dependencies: { taskId: string, dependsOn: string[] }[]  // 依赖关系
}

// ExecutionTask 定义见 §12.10.2
}
```

**拆分策略**：

| 决策 scope | 拆分方式 | 示例 |
|------------|---------|------|
| single_file | 1 个任务 | 修改 auth.ts |
| multi_file | 按文件拆，可并行 | auth.ts + routes.ts + test.ts |
| module | 按职责拆，有依赖 | middleware → endpoint → test |
| project | 按模块拆，有依赖 | auth 模块 → user 模块 → 集成测试 |

**Prompt 精简原则**：子 agent 不需要知道"为什么这么做"（Orchestrator 的事），只需要知道"做什么 + 怎么算做对了"。

```
错误做法（注入一切，~2500 tokens）：
  "你是 Developer 角色。以下是会议历史：{3000 tokens}
   以下是项目上下文：{1000 tokens}
   以下是角色记忆：{500 tokens}
   请实现：{决策}"

正确做法（只注入需要的，~500 tokens）：
  "实现以下功能：
   【决策】JWT + refresh token
   【验收标准】
   1. /login 返回 access_token + refresh_token
   2. refresh_token 存 Redis
   【约束】secret 从环境变量读取
   【已知陷阱】token 存储必须用 Redis，不能用 Map
   【角色经验】Developer 做 auth 类任务成功率 92%；上次同类任务失败原因：Prisma 连接池耗尽，fix: 指数退避重试
   【相关文件】src/middleware/auth.ts（如存在则修改，不存在则创建）"
```

Orchestrator 写 ExecutionPlan → PostgreSQL，然后等待。

##### ③ EXECUTION：AgentRouter 读取计划，spawn 子 agent

AgentRouter 是 Studio API 服务内的纯执行层，不感知业务逻辑。

```
AgentRouter 读取 ExecutionPlan
  │
  ├→ 分析依赖关系
  │   Task A（无依赖）→ 立即执行
  │   Task B（依赖 A）→ 等 A 完成
  │   Task C（依赖 B）→ 等 B 完成
  │   Task D（无依赖）→ 与 A 并行执行
  │
  ├→ 对每个就绪的 Task：
  │   1. 创建 Git Worktree（从主分支，sandbox 级别 2）
  │   2. 选择 agent（按 task.agent 字段）
  │   3. 根据 task.requiredTools 配置 MCP Server（113 个 tools）
  │   4. spawn 子进程（注入 MCP 工具源 + 精简 prompt + LLM 配置，详见 12.11）
  │   5. 等待完成或超时
  │
  ├→ Sanity Check（AgentRouter 层，秒级抽查）：
  │   - tsc --noEmit 通过？（防 sub-agent 说谎）
  │   - 文件变更范围合理？
  │
  └→ 汇总结果，写 ExecutionSummary → PostgreSQL
```

**关键优化：验证下沉到 Sub-agent。**

Sub-agent 自己负责"做对"——prompt 中明确要求 sub-agent 在返回前完成自检：

```
Sub-agent prompt 中的完成条件：
  "【完成条件】
   - 代码写完后，运行 npx tsc --noEmit 确认编译通过
   - 运行 pnpm test 确认测试通过
   - 运行 pnpm lint 确认无新增错误
   - 如果测试不通过，修复后重试，最多 3 次
   - 只有全部通过才算完成
   【输出格式】
   { files: [...], tests_passed: true, lint_passed: true, notes: '...' }"
```

Sub-agent（Claude Code / Codex）本身有 shell 能力，可以自己跑命令、自己修 bug、自己重试。**失败在 sub-agent 内部闭环，不需要传回 Orchestrator。**

```
Sub-agent 内部执行循环：
  写代码 → tsc --noEmit
    ├→ 通过 → pnpm test
    │         ├→ 通过 → pnpm lint
    │         │         ├→ 通过 → 输出结果
    │         │         └→ 失败 → 修 lint 错误 → 重试（最多 3 次）
    │         └→ 失败 → 修测试 → 重试（最多 3 次）
    └→ 失败 → 修编译错误 → 重试（最多 3 次）

  3 次都失败 → 返回 { tests_passed: false, error: "..." }
```

**并行任务的依赖传递用文件，不用 DB：**

```
Task A 和 Task B 在同一个 worktree：
  Task A 完成 → 代码写入 worktree 文件
  Task B 的 prompt："参考 worktree 中 Task A 已完成的 auth.ts"
  Task B 自己读文件，不需要通过 DB 传递 Task A 的结果
```

Sub-agent 输出精简 JSON（~200 tokens）：

```
{
  "files_changed": ["src/middleware/auth.ts", "src/routes/auth.ts"],
  "tests_passed": true,
  "lint_passed": true,
  "self_retries": 1,
  "notes": "第 1 次测试失败（Redis 连接问题），修复后通过"
}
```

AgentRouter 汇总所有子任务结果，写入 ExecutionSummary：

```typescript
interface ExecutionSummary {
  decisionId: string
  status: 'ALL_PASS' | 'PARTIAL' | 'FAIL'
  tasks: {
    id: string
    agent: string
    filesChanged: string[]
    testsPassed: boolean
    selfRetries: number
    duration: number
  }[]
  totalSelfRetries: number
  totalDuration: number
}
```

**Orchestrator 只看 status 字段：**
- `ALL_PASS` → 只做 LLM 裁判（语义验证）
- `PARTIAL` / `FAIL` → 才看具体哪个任务失败

##### ④ VERIFY：Orchestrator 只做语义验证

Sub-agent 已经自己保证了编译/测试/lint 通过。Orchestrator 不需要重复做规则验证，只做 **LLM 裁判——语义级的决策对比**。

```
Orchestrator 读取 ExecutionSummary
  │
  ├→ status = ALL_PASS
  │   → 一次性 LLM 裁判（所有子任务一起验证，不是逐个）
  │
  ├→ status = PARTIAL
  │   → 看哪个任务 tests_passed = false
  │   → 注入偏差信息，重新 spawn 该任务
  │
  └→ status = FAIL
      → 看失败原因
      → 注入错误信息，重新 spawn（最多 2 次）
      → 连续 3 次失败 → 停止，通知人工
```

**LLM 裁判（批量验证，不是逐个）：**

```
LLM 裁判 prompt（~500 tokens）：
  "【决策】JWT + refresh token"
  "【验收标准】"
  "1. /login 返回 access_token + refresh_token"
  "2. refresh_token 存 Redis"
  "3. secret 从环境变量读取"
  "【实现汇总】"
  "status: ALL_PASS"
  "files: [auth.ts, routes.ts, auth.test.ts]"
  "totalSelfRetries: 1"
  "请逐条判定验收标准：MET / NOT_MET，有偏差说明具体原因。"

输出：
{
  "verdict": "PASS",
  "criteriaResults": [
    { "criterion": "/login 返回 token", "status": "MET" },
    { "criterion": "refresh_token 存 Redis", "status": "MET" },
    { "criterion": "secret 从环境变量读取", "status": "MET" }
  ]
}
```

**失败重试策略（两层）：**

```
第一层：Sub-agent 内部自检重试（不经过 Orchestrator）
  编译失败 → sub-agent 自己修 → 重试（最多 3 次）
  测试失败 → sub-agent 自己修 → 重试（最多 3 次）
  → 大多数问题在这一层解决

第二层：Orchestrator 语义验证重试（只处理 LLM 裁判发现的问题）
  验收标准未满足 → Orchestrator 注入偏差 → 重新 spawn
  → 只有"代码能跑但不符合决策意图"才到这一层

第三层：人工介入
  连续 3 次 Orchestrator 重试失败 → 停止，通知用户
```

##### ⑤ WRITEBACK：结果回写 Topic

验证通过后，Orchestrator 将结果写回 Topic：

```typescript
interface TopicResult {
  decisionId: string
  finalVerdict: 'PASS' | 'PARTIAL→FIXED' | 'FAIL'
  executionSummary: ExecutionSummary      // 来自 AgentRouter
  verificationResult: {                   // 来自 LLM 裁判
    criteriaResults: { criterion: string; status: string }[]
  }
}
```

回写后，Topic 1 完成 → Orchestrator 压缩为 1 行摘要存入记忆：

```
"Topic 1: JWT 认证方案 | 3 子任务 | ALL_PASS | 5min | self-retries: 1"
```

下一个 Topic 到来时，Orchestrator 只带着这行摘要，不带着原始的执行细节。

#### 12.10.6 每一步对应哪个 harness 模块

| 流程步骤 | 执行层 | 对应 harness 模块 | 作用 |
|----------|--------|-------------------|------|
| ① Discussion | Orchestrator | `safety/` + `gates/` | stance 辩论 + 共识检查 |
| ② Planning | Orchestrator | `context/token-pipeline.ts` | Prompt 精简，只注入需要的 |
| ③ Execution - spawn | AgentRouter | `llm/adapter.ts` + `sandbox.ts` + `tools/mcp-server` | 统一接口 + worktree 隔离 + MCP 工具暴露 + LLM 配置注入（12.11） |
| ③ Execution - 自检 | **Sub-agent 自己做** | `gates/`（sub-agent 内调用） | tsc/lint/test，sub-agent 内部闭环 |
| ③ Execution - 自重试 | **Sub-agent 自己做** | `failure/`（sub-agent 内处理） | 编译/测试失败，sub-agent 自己修自己重试 |
| ③ Execution - sanity check | AgentRouter | `gates/` 质量门禁 | 抽查 tsc 通过，防 sub-agent 说谎 |
| ④ Verify - LLM 裁判 | Orchestrator | `gates/` + LLM 裁判 | 语义验证，批量检查所有验收标准 |
| ④ Verify - 偏差重试 | Orchestrator → AgentRouter | `failure/classifier.ts` | 语义级偏差，注入偏差信息重新 spawn |
| ⑤ Writeback | Orchestrator | `knowledge/store.ts` | 执行记录持久化到 Topic |
| ⑥ Knowledge - 提取 | Orchestrator | `knowledge/ARCHIVE` | 从执行产物自动提取知识 |
| ⑥ Knowledge - 成熟度 | Orchestrator | `knowledge/lifecycle.ts` | draft → verified → proven |
| ⑥ Knowledge - 衰减 | 独立定时任务 | `monitoring/knowledge-evolver.ts` | 长期未引用自动降级 |

#### 12.10.7 保留 vs 删除 vs 新增

| 组件 | 命运 | 理由 |
|------|------|------|
| stance-based 辩论（8 种立场） | **保留** | 反群体思维设计好 |
| Devil's Advocate 注入 | **保留** | 对抗性审查有价值 |
| 共识检查（每 3 轮） | **保留** | 自动判定 unanimous/majority/divided |
| 强制仲裁（decider） | **保留** | 达不成共识时有兜底 |
| 渐进式上下文披露（4 层） | **保留** | Token 控制好 |
| 8 状态 FSM (pending→discussing→designing→task_splitting→executing→testing→reviewing→completed) | **删除** | 硬编码流程 → Goal 驱动 |
| task_splitting 状态 | **删除** | Orchestrator 自主拆任务 |
| executing/testing/reviewing 状态 | **删除** | AgentRouter 直接执行+验证 |
| Redis 临时存储 | **改为 PostgreSQL** | 持久化 + 作为 Orchestrator↔AgentRouter 通信介质 |
| 会后 TaskSplitter | **删除** | Orchestrator 自主拆任务 |
| Orchestrator Agent（Claude Code） | **新增** | 每个 PMO 会议的主 Agent，协调+规划+验证+知识提取 |
| AgentRouter + AgentAdapter | **新增** | 纯执行层，读取计划 → spawn → 规则验证 → 写结果 |
| MCP Server（Studio Tools） | **新增** | 113 个 tools 注册为 MCP 工具，暴露给 sub-agent |
| 角色记忆注入 | **新增** | spawn 时通过 token pipeline 注入精简知识 |
| 知识自动提取 | **新增** | Topic 结束 → ARCHIVE → 知识入库 |

#### 12.10.8 演进路径

```
v1（当前）：临时会议 + LLM 模拟角色讨论 + Redis 存储 + task-worker（坏的）
v2（近期）：PMO 项目会议 + LLM 模拟角色讨论 + PostgreSQL 存储 + 知识提取
v3（远期）：PMO 项目会议 + LLM 角色讨论 + 真实编码 Agent 执行 + 角色知识沉淀
```

v1→v2：持久化 + 知识闭环，不改变 Agent 的 LLM 模拟本质。
v2→v3：引入 AgentRouter + AgentAdapter，讨论决策后 spawn 真实编码 agent 执行。
v3 是完整形态：**讨论用 LLM 角色（便宜），执行用真实 agent（强大），知识沉淀到角色记忆库（复利）。**

#### 12.10.9 数据模型变更

| 变更 | 说明 |
|------|------|
| `Meeting` 加 `projectId` | 关联 PMO，生命周期绑定 |
| 新增 `Topic` 模型 | 会议内的议题线程 |
| `Message` 迁 PostgreSQL | 持久化，替代 Redis |
| 新增 `AgentSubscription` | Agent-议题订阅关系 |
| 新增 `AgentExecution` | Agent 执行记录（输入/输出/耗时/角色） |
| 新增 `RoleMemory` | 角色经验记忆（关联 knowledge engine） |
| 新增 `LLMConfig` | LLM 配置加密存储（详见 12.11） |

属于 **O5（Agent-Native 基础设施）**，依赖 harness 知识引擎就绪后实施。

### 12.11 LLM 配置体系：UI 配置 → 安全存储 → 分层下发

#### 12.11.1 现状问题

Studio 当前有 **三套独立的 LLM 客户端**，配置来源各不相同，UI 设置实际上到不了 Agent：

| 客户端 | 位置 | 配置来源 | 问题 |
|--------|------|---------|------|
| Client A (legacy) | `llm/client.ts` | 硬编码 Tencent GLM-5 key + env cascade | **P0: key 明文写在源码里** |
| Client B (proxy) | `llm/proxy.ts` | `process.env.LLM_API_KEY_USER` | UI 写入内存，重启丢失；子进程读不到 |
| Client C (shared) | `studio-shared/llm-client.ts` | `process.env.CODING_API_KEY_1` | 和 UI 配置完全无关 |

**配置流断裂：** UI → `process.env`（内存）→ TaskWorker 通过 `execAsync` 跑 shell 子进程 → 子进程读自己的 env → UI 设的值根本到不了 agent。

**安全漏洞清单（12.8 已列出，此处补充 LLM 相关）：**

| # | 问题 | 严重度 |
|---|------|--------|
| 1 | `client.ts:29` 硬编码 Tencent API Key | **P0** |
| 2 | `proxy.ts:207` API key 明文写 process.env，无加密 | **P1** |
| 3 | `Settings.tsx:86` API key 明文存 localStorage | **P1** |
| 4 | `/api/v1/llm/*` 路由无 auth 中间件 | **P1** |
| 5 | GET `/config/status` 返回 baseUrl/model，虽未返回 key 但无权限控制 | **P2** |
| 6 | 无速率限制，可耗尽 API 配额 | **P2** |

#### 12.11.2 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│  Settings UI (前端)                                           │
│  - 不再存 localStorage (key 部分)                             │
│  - POST /api/v1/settings/llm-config                          │
│  - 只展示 key 的后 4 位 (****abcd)，不回传完整 key             │
│  - 支持多配置 profile: orchestrator / agent_default / role    │
└──────────────────────────┬───────────────────────────────────┘
                           │ requireAuth + requireRole('admin')
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Settings API (后端)                                          │
│  - AES-256-GCM 加密 apiKey 后存 DB（复用 meeting encryption） │
│  - Prisma LLMConfig 表                                       │
│  - GET 返回 masked key，PUT 更新时接收完整 key                │
└──────────────────────────┬───────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
      Orchestrator    AgentRouter     Studio 自身
      (Claude Code)   (spawn 子进程)   (intent/skill)
```

#### 12.11.3 数据模型：LLMConfig 表

```prisma
model LLMConfig {
  id          String   @id @default(cuid())
  scope       String   // 配置作用域，见下表
  provider    String   // 'anthropic' | 'openai' | 'tencent' | 'custom'
  baseUrl     String?  // 自定义 endpoint
  apiKeyEnc   String   // AES-256-GCM 加密后的密文
  apiKeyIv    String   // 16 字节 IV
  apiKeyTag   String   // GCM auth tag
  model       String   // 默认模型 ID
  options     Json?    // 可选参数：temperature, maxTokens, etc.
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([scope, provider])
  @@index([scope])
}
```

**scope 枚举值（分层配置）：**

| scope | 含义 | 使用者 |
|-------|------|--------|
| `orchestrator` | 主控 Agent 专用 | Claude Code Orchestrator 进程 |
| `agent_codex` | Codex 子 agent | AgentRouter spawn codex 时注入 |
| `agent_claude` | Claude Code 子 agent | AgentRouter spawn claude-code 时注入 |
| `agent_opencode` | OpenCode 子 agent | AgentRouter spawn opencode 时注入 |
| `agent_default` | 子 agent 兜底 | 未指定专属配置时使用 |
| `studio` | Studio 自身 LLM 调用 | intent-analyzer, creation-analyzer, skill-gen |

#### 12.11.4 配置覆盖优先级

每一层向下覆盖，优先级从高到低：

```
1. LLMConfig(scope=具体值)     ← DB 中的精确匹配
2. LLMConfig(scope='agent_default')  ← 子 agent 兜底（仅 agent_* 生效）
3. process.env                 ← 部署时环境变量（最终兜底）
4. 硬编码默认值                ← 仅 provider 和 model 的合理默认，不含 key
```

以 Codex 子 agent 为例：

```
查找顺序：
  LLMConfig(scope='agent_codex')  → 找到？用它
  LLMConfig(scope='agent_default') → 找到？用它
  process.env.OPENAI_API_KEY       → 有？用它
  报错：无可用 LLM 配置
```

Orchestrator 和 Studio 自身走各自的 scope，不参与 agent_default 兜底。

#### 12.11.5 安全设计

**加密存储：**

复用 `apps/api/src/modules/meetings/encryption.ts` 的 AES-256-GCM 实现，使用 `ENCRYPTION_KEY` 环境变量。加密流程：

```
前端 POST apiKey 明文
  → HTTPS (TLS 传输加密)
  → 后端 decrypt 不存在的旧值（首次配置）
  → encrypt(apiKey, ENCRYPTION_KEY)
  → 存 DB: apiKeyEnc + apiKeyIv + apiKeyTag
```

**API 设计：**

```
POST /api/v1/settings/llm-config
  Body: { scope, provider, baseUrl, apiKey, model, options }
  Auth: requireAuth + requireRole('admin')
  行为: 加密 apiKey → UPSERT LLMConfig

GET /api/v1/settings/llm-config/:scope
  Auth: requireAuth + requireRole('admin')
  返回: { scope, provider, baseUrl, model, options, apiKeyMasked: "****abcd" }
  注意: 不返回完整 apiKey

DELETE /api/v1/settings/llm-config/:scope
  Auth: requireAuth + requireRole('admin')

POST /api/v1/settings/llm-config/test
  Body: { scope }
  Auth: requireAuth + requireRole('admin')
  行为: 用该 scope 的配置发一个简单请求，验证连通性
  返回: { ok: boolean, model: string, latencyMs: number }
```

**子进程注入（不落盘）：**

```typescript
// AgentRouter spawn 子进程时
async function spawnWithConfig(task: ExecutionTask) {
  const config = await resolveLLMConfig(`agent_${task.agent}`);

  // apiKey 只在内存中短暂存在：解密 → 注入 env → 子进程启动 → GC
  const env: Record<string, string> = {
    ...process.env,           // 继承基础 env
    LLM_MODEL: config.model,  // 覆盖模型
  };

  // 按 provider 注入对应的 key 变量名
  switch (config.provider) {
    case 'anthropic':
      env.ANTHROPIC_API_KEY = decrypt(config.apiKeyEnc, config.apiKeyIv, config.apiKeyTag);
      break;
    case 'openai':
      env.OPENAI_API_KEY = decrypt(config.apiKeyEnc, config.apiKeyIv, config.apiKeyTag);
      break;
    case 'tencent':
      env.CODING_API_KEY = decrypt(config.apiKeyEnc, config.apiKeyIv, config.apiKeyTag);
      break;
    case 'custom':
      env.LLM_API_KEY = decrypt(config.apiKeyEnc, config.apiKeyIv, config.apiKeyTag);
      env.LLM_BASE_URL = config.baseUrl!;
      break;
  }

  if (config.options) {
    if (config.options.temperature) env.LLM_TEMPERATURE = String(config.options.temperature);
    if (config.options.maxTokens) env.LLM_MAX_TOKENS = String(config.options.maxTokens);
  }

  // spawn 子进程，env 作为参数传入，不写 process.env
  return execFile(task.command, task.args, { env, timeout: task.timeout });
}
```

**安全边界总结：**

| 环节 | 措施 |
|------|------|
| 传输 | HTTPS（前端→后端） |
| 存储 | AES-256-GCM 加密，DB 存密文 |
| 内存 | 解密后仅存在于 spawn 调用的局部变量，不写全局 process.env |
| 前端 | 只展示 masked key (****abcd)，不回传完整 key |
| 权限 | 所有 LLM 配置路由 requireAuth + requireRole('admin') |
| 日志 | 日志中 apiKey 字段自动脱敏（middleware 层拦截） |
| 子进程 | env 参数传入，子进程结束后 env 随进程销毁 |

#### 12.11.6 前端 Settings 页面改造

**当前 UI 结构：**

```
Settings
├── Studio LLM        ← 单一配置，endpoint + apiKey + model
├── Role Execution    ← maxConcurrent, tokenWarningThreshold
├── Context Monitor   ← warning/critical threshold
├── Discord / WeCom / Telegram
```

**改造后 UI 结构：**

```
Settings
├── LLM 配置
│   ├── Orchestrator (主控 Agent)
│   │   ├── Provider: [anthropic ▾]
│   │   ├── Model: [claude-opus-4-7 ▾]
│   │   ├── API Key: [****xxxx] [修改]
│   │   └── [测试连接]
│   │
│   ├── 子 Agent 默认配置
│   │   ├── Provider: [anthropic ▾]
│   │   ├── Model: [claude-sonnet-4-6 ▾]
│   │   ├── API Key: [****xxxx] [修改]  ← 可复用 orchestrator 的 key
│   │   └── [测试连接]
│   │
│   ├── Codex 专用 (可选覆盖)
│   │   └── ... 同上 ...
│   │
│   └── Studio 内部 LLM
│       └── ... 同上 ...
│
├── 执行配置
│   ├── 最大并发: [3]
│   ├── Token 告警阈值: [80000]
│   └── 显示 Token 用量: [✓]
│
├── 通知配置
│   ├── Discord / WeCom / Telegram
│   └── ...
│
└── 高级
    ├── 环境变量覆盖说明
    └── 配置导入/导出
```

**关键交互细节：**

- API Key 输入框默认显示 masked 值 `****abcd`，点击 [修改] 后变为可编辑的 password 输入框
- 未修改时 PUT 请求不包含 apiKey 字段，后端不更新该字段
- Provider 下拉切换后，Model 下拉联动更新可选列表
- [测试连接] 按钮发 POST `/settings/llm-config/test`，显示延迟和模型信息
- "复用 Orchestrator 的 key" 复选框：勾选后子 agent 配置不单独存 key，读取时 fallback 到 orchestrator scope

#### 12.11.7 统一 LLM 客户端

改造后，三套客户端合并为一套：

```typescript
// packages/studio-shared/src/llm/llm-client.ts (改造后)

interface ResolvedLLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;    // 运行时解密，不持久化
  model: string;
  options?: { temperature?: number; maxTokens?: number; };
}

async function resolveLLMConfig(scope: string): Promise<ResolvedLLMConfig> {
  // 1. 查 DB
  const dbConfig = await prisma.lLMConfig.findFirst({
    where: { scope, isActive: true },
  });
  if (dbConfig) {
    return {
      provider: dbConfig.provider,
      baseUrl: dbConfig.baseUrl || defaultBaseUrl(dbConfig.provider),
      apiKey: decrypt(dbConfig.apiKeyEnc, dbConfig.apiKeyIv, dbConfig.apiKeyTag),
      model: dbConfig.model,
      options: dbConfig.options as any,
    };
  }

  // 2. 环境变量 fallback
  const envKey = getEnvKey(scope);
  if (envKey) return envKey;

  // 3. 无配置
  throw new LLMConfigNotFoundError(scope);
}
```

所有模块统一调用 `resolveLLMConfig(scope)`，不再各自读 process.env。

#### 12.11.8 迁移路径

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **M1: 安全修复** | 移除 client.ts 硬编码 key；LLM 路由加 auth 中间件 | 无 |
| **M2: DB 存储** | 新增 LLMConfig 表；Settings API 加密存储；前端改造 | M1 |
| **M3: 统一客户端** | 三套 client 合并为 resolveLLMConfig()；子进程注入 env | M2 |
| **M4: 分层配置** | scope 体系上线；AgentRouter 按 scope 注入不同配置 | M3 + 12.10 三层架构 |

M1 可以立即做（安全修复不依赖架构改造）。M2-M4 随 12.10 三层 Agent 架构同步推进。

### 12.12 知识进化引擎：闭环的最后一步

#### 12.12.1 知识飞轮回顾与缺口定位

第二章定义了知识闭环五阶段：**来→存→用→对→好**。12.9 和 12.10 详细设计了前三环（MCP 化让"用"更顺畅，三层架构让"来"有更多入口），harness 约束系统覆盖了"对"。

但**"好"这一环是最薄弱的**——当前只有成熟度升降和自动衰减，没有回答：

- 什么信号触发进化？
- 进化产出是什么形态？
- 产出怎么回到执行层？

```
① 来 → ② 存 → ③ 用 → ④ 对 → ⑤ 好
                 ↑                 │
                 └─────────────────┘
                 ⑤ 的产出回到 ③ 用
                 才是真正的闭环
```

本节补完"好"的具体实现，并证明：**所有进化产物本质上都是知识的不同形态。**

#### 12.12.2 核心洞察：进化产物 = 知识形态

| 进化产物 | 本质 | 知识库类型 | 注入点 |
|---------|------|----------|--------|
| Constraint 变更 | "什么不能做"的知识 | guideline / iron_law | harness definitions.ts |
| Skill | "怎么做"的知识 | process | MCP Tool 注册表 |
| SOP | "按什么顺序做"的知识 | process | Orchestrator PLANNING 参考 |
| Prompt 模板 | "怎么表达需求"的知识 | guideline (recommend) | AgentRouter prompt 注入 |
| Pitfall | "什么会出错"的知识 | pitfall | Sub-agent prompt 注入 |
| 角色能力画像 | "谁擅长什么"的知识 | model | Orchestrator 任务分配 |

**知识是主线，进化是飞轮的闭环。** Harness 的每一个子系统——约束、验证、监控、上下文——最终都服务于知识的流动。进化引擎让知识从"被消费"升级为"被改进"。

#### 12.12.3 三层进化闭环

进化不是单一流水线，而是三个时间尺度的闭环同时运行：

```
┌─────────────────────────────────────────────────────────────────┐
│                    进化体系：三个时间尺度                          │
├──────────────┬──────────────────┬───────────────────────────────┤
│  微观（分钟）  │  中观（天）       │  宏观（周/月）                  │
│  自我修正      │  知识提取         │  趋势进化                      │
├──────────────┼──────────────────┼───────────────────────────────┤
│ Sub-agent    │ Orchestrator     │ Evolution Engine              │
│ 内部重试      │ ARCHIVE 阶段     │ 定时任务                       │
├──────────────┼──────────────────┼───────────────────────────────┤
│ 输入：单任务   │ 输入：单次会议     │ 输入：跨时间聚合数据             │
│ 失败信号      │ 全流程产物        │ traces + failures + metrics   │
├──────────────┼──────────────────┼───────────────────────────────┤
│ 输出：修复     │ 输出：知识条目     │ 输出：SOP / Skill / 约束变更    │
│ 后重试        │ + 决策记录        │ + 角色经验 + Prompt 优化        │
├──────────────┼──────────────────┼───────────────────────────────┤
│ 0 token 成本  │ ~500 tokens      │ ~2000 tokens (LLM 分析)       │
│ 纯规则        │ LLM 提取         │ LLM 分析 + 规则校验             │
└──────────────┴──────────────────┴───────────────────────────────┘
```

##### 层一：微观进化 — Sub-agent 自我修正

12.10.5 已设计 sub-agent 自检 + 自重试（最多 3 次）。AgentResult 中的 `failureLog` 字段（§12.10.2 已定义）是进化的原材料——没有失败记录，就没有进化素材。微观层的产出是中观层的输入。

##### 层二：中观进化 — Orchestrator 知识提取

ARCHIVE 阶段从会议全流程中提取知识，按信号强度决定产出形式：

| 信号强度 | 条件 | 产出 |
|---------|------|------|
| 低 | 出现 1-2 次 | 只记录，不产出 |
| 中 | 出现 3-5 次 | Knowledge 条目 (draft) |
| 高 | 出现 6-10 次 | Knowledge 条目 (verified) + Skill 候选 |
| 极高 + 成功率高 | >10 次 + successRate > 90% | Skill 正式注册 + SOP 提取 |
| 极高 + 失败率高 | >10 次 + failRate > 50% | Constraint 变更提案 |

提取流程：

```
ARCHIVE 阶段
  │
  ├→ 读取 Topic 的 Message 记录
  │   → 提取 decision（结构化决策已有）
  │   → 提取 discussion 中的 guideline / pitfall（LLM 分类）
  │
  ├→ 读取 ExecutionSummary.failureLog
  │   → 同一 rootCause 出现 ≥2 次 → 生成 pitfall 条目
  │   → 同一 fix 模式出现 ≥3 次 → 生成 guideline 条目
  │
  ├→ 读取会议全流程
  │   → 可复现的成功路径 → 生成 process (SOP) 条目
  │   → 重复操作模式出现 ≥3 次 → 生成 skill 候选
  │
  └→ 所有产出写入知识库，source = "auto-extract"，maturity = draft
```

##### 层三：宏观进化 — Evolution Engine

独立定时任务，聚合跨时间数据，产出高阶进化物：

```
Evolution Engine (每天/每周)
  │
  ├→ 数据源 1: Harness traces
  │   → TraceAnalyzer（异常检测）→ ConstraintDoctor（根因）→ ConstraintEvolver（提案）
  │   → 【补完】提案进入审批流 → 自动执行或人工审批
  │
  ├→ 数据源 2: FailureRecorder
  │   → 按 errorType + rootCause 聚合
  │   → 同一根因 ≥3 次 → 升级为 constraint 或 guideline
  │
  ├→ 数据源 3: Skill usage stats
  │   → successRate < 30% + usageCount > 20 → 标记淘汰候选
  │   → successRate > 95% + 多角色使用 → 标记推荐
  │
  ├→ 数据源 4: Role performance
  │   → 按任务类型拆解质量分
  │   → 角色能力画像更新
  │
  └→ 产出 → 审批流 → 自动执行（低风险）或 人工审批（高风险）
```

#### 12.12.4 进化产出的自动执行

进化不是为了"记录"，是为了"下次更快更好"。产出物必须能被下次执行自动消费。

**低风险变更 → 自动执行：**

| 产出类型 | 自动执行动作 | 回滚方式 |
|---------|------------|---------|
| Knowledge 条目 | 写入知识库，自动进入索引 | 标记 archived |
| Prompt 模板 | 写入 prompt 库，版本化 | 回退到上一版本 |
| 角色能力画像 | 更新 Role.memory | 重新计算 |
| Skill 标记淘汰 | 移出推荐列表 | 恢复 active 状态 |

**进化产物的消费路径（闭环的关键）：**

所有进化产物（Knowledge 条目、Prompt 模板、角色画像）写入后，通过以下路径被下次执行消费：

```
ARCHIVE/Evolution Engine 写入知识库
  → 下次 Orchestrator 启动时 queryKnowledge(项目相关)
  → Token Pipeline 收集 → 排序（成熟度高的优先）→ 注入 prompt
  → Orchestrator PLANNING 时参考（SOP、角色画像、已知陷阱）
  → Sub-agent prompt 中包含【角色经验】+【已知陷阱】
```

不需要额外的"注入触发"——知识库是共享存储，`queryKnowledge` 是 Orchestrator 的标准工具，写入即可见。

**高风险变更 → 审批后执行：**

| 产出类型 | 审批方式 | 执行动作 |
|---------|---------|---------|
| Constraint 变更 | 生成 PR → CI → maintainer review | 合并后自动生效 |
| Skill 正式注册 | 生成 YAML → 人工审批 | 合并到 tools/std/ |
| SOP 发布 | 生成文档 → 人工审批 | 写入知识库 Layer 1/2 |

**约束提案执行机制（补充）：**

harness 是 npm 库，约束定义在 `src/core/constraints/definitions.ts`。"合并后自动生效"的具体路径：

1. Evolution Engine 生成 `ConstraintProposal`（已有，保存在 `.harness/proposals/`）
2. **新增** `ProposalExecutor` 模块：读取 proposal → 创建 Git 分支 → 修改 `definitions.ts` → 提交 → 创建 PR
3. CI 运行 harness 测试套件 → 通过后等待 maintainer review
4. maintainer 合并 PR → npm 发布新版本 → Studio `npm update @dommaker/harness` → 新约束生效

**低风险变更（Knowledge/Prompt/角色画像）的执行机制：**

这些不涉及 harness 库代码，直接通过 `KnowledgeStore.ingest()` MCP tool 写入。Evolution Engine 作为 Orchestrator 的定时任务运行，调用已有的 MCP tools 完成写入，不需要额外的执行机制。

**约束膨胀防护：**

```
约束总数上限：50 条（Iron Law 10 + Guideline 30 + Tip 10）
新增约束必须先删一条同类低价值约束，或合并两条相似约束
  → ConstraintEvolver.propose() 时检查上限
  → 超出时触发"约束 Lint"：识别相似/矛盾/低效约束，建议合并或删除
```

#### 12.12.5 知识生命周期：防退化机制

进化系统必须有退化防护——防止知识库无限膨胀、约束越加越多、僵尸技能堆积。

**知识自动衰减（与 12.10.3 成熟度体系联动）：**

```
draft → 被引用 1 次 → verified → 被引用 ≥3 次 + ≥2 项目 → proven
proven → 12 个月未引用 → verified → 6 个月未引用 → draft → 持续未引用 → 归档
```

**Skill 淘汰：**

```
每周检查：
  successRate < 30% + usageCount > 20     → "待优化"
  successRate < 30% + 连续 4 周无使用      → "淘汰候选" → 通知 maintainer
  successRate > 95% + usageCount > 50     → "推荐" → 提升排序权重
```

**约束 Lint（借鉴 Karpathy LLM Wiki）：**

```
定期检查：
  矛盾检测：同主题两条约束结论相反 → 标记冲突
  孤儿检测：12 个月无触发记录 → 标记候选删除
  重复检测：相似度 > 80% 的两条约束 → 建议合并
  覆盖检测：某类操作无任何约束覆盖 → 提醒补充
```

#### 12.12.6 角色记忆：三层记忆架构

角色的"记忆"不是单一存储，而是三层：

```
┌─────────────────────────────────────────────┐
│  Layer 3: 统计记忆 (已有)                     │
│  qualityScore, satisfactionRate, tasksCount  │
│  → 用于晋升/降级决策                          │
├─────────────────────────────────────────────┤
│  Layer 2: 事件记忆 (新增)                     │
│  每次任务的 failureLog + 成功路径              │
│  → 用于同类任务参考                           │
├─────────────────────────────────────────────┤
│  Layer 1: 能力画像 (新增)                     │
│  按任务类型拆解的质量分 + 擅长/不擅长领域      │
│  → 用于任务分配决策                           │
└─────────────────────────────────────────────┘
```

**事件记忆数据模型：**

```prisma
model RoleExperience {
  id            String   @id @default(cuid())
  roleId        String
  taskType      String   // 'auth' | 'api' | 'ui' | 'test' | 'deploy'
  outcome       String   // 'success' | 'failure' | 'partial'
  failureType   String?  // 失败分类
  rootCause     String?  // 根因
  fix           String?  // 修复方式
  filesChanged  String[] // 涉及文件
  duration      Int      // 耗时(ms)
  knowledgeRefs String[] // 引用的知识条目 ID
  createdAt     DateTime @default(now())

  @@index([roleId, taskType])
  @@index([outcome, failureType])
}
```

**Orchestrator 任务分配时查询：**

```
"auth 类任务分配给谁？"
  → RoleExperience(taskType='auth', outcome='success')
  → Developer 成功率 92%，Designer 成功率 60%
  → 分配给 Developer

"Developer 做 auth 有什么已知坑？"
  → RoleExperience(roleId='developer', taskType='auth', outcome='failure')
  → "上次 Prisma 连接池耗尽，fix: 添加指数退避重试"
  → 注入 Sub-agent prompt
```

#### 12.12.7 完整知识流动全景

将进化引擎接入第二章的知识闭环，形成完整流动路径：

```
① 来 (Ingest)
  ├→ 会议讨论 → Orchestrator 提取 decision/guideline/pitfall
  ├→ 任务执行 → Sub-agent 输出 failureLog
  ├→ 冷启动导入 → /flow-import 批量导入
  └→ 团队共建 → Git 协作贡献知识条目
         │
         ▼
② 存 (Store)
  ├→ 知识库：五层存储 × 五种类型 × 三级成熟度
  ├→ LLMConfig：加密分层配置（12.11）
  ├→ Constraint：definitions.ts 三层约束
  └→ RoleExperience：角色事件记忆
         │
         ▼
③ 用 (Consume)
  ├→ Sub-agent prompt 注入：相关 pitfall + guideline + 角色经验
  ├→ Orchestrator PLANNING：参考 SOP + 角色能力画像分配任务
  ├→ MCP Tools：Skill 作为可调用工具
  └→ Constraint：checkConstraints() 自动执行
         │
         ▼
④ 对 (Verify)
  ├→ Sub-agent 自检：tsc/lint/test
  ├→ AgentRouter：sanity check
  ├→ Orchestrator：LLM 裁判语义验证
  └→ Harness：约束检查 + 质量门禁
         │
         ▼
⑤ 好 (Improve) ←←← 12.12 补完
  ├→ 微观：Sub-agent 自我修正（failureLog 产出）
  ├→ 中观：ARCHIVE 知识提取（Knowledge/Skill/SOP 产出）
  ├→ 宏观：Evolution Engine（Constraint 变更/Prompt 优化/角色画像）
  └→ 防退化：知识衰减 + Skill 淘汰 + 约束 Lint
         │
         ▼
  回到 ③ 用：进化产物自动注入下次执行
```

**知识是主线。Harness 的每一个子系统——约束、验证、监控、上下文——最终都服务于知识的流动。进化引擎让知识从"被消费"升级为"被改进"，闭环因此成立。**

#### 12.12.8 实施优先级

| 优先级 | 内容 | 依赖 | 价值 |
|--------|------|------|------|
| **P0** | failureLog 输出字段 | 12.10 Sub-agent 架构 | 进化原材料，没有它后面全白搭 |
| **P1** | ARCHIVE 知识提取 | P0 + 知识库 | 每次会议自动沉淀经验 |
| **P1** | RoleExperience 表 + 任务分配 | 12.10 Orchestrator | 让任务分配从"拍脑袋"变"看数据" |
| **P2** | Evolution Engine 约束进化 | P1 + harness traces | 补完 ConstraintEvolver 的执行环节 |
| **P2** | Skill 淘汰机制 | P1 + usage stats | 清理僵尸技能 |
| **P3** | 知识衰减 + 约束 Lint | P2 | 防退化，长期健康 |

---

### 12.13 性能优化 (2026-05-02)

后端 + 前端性能改进，提升响应速度和加载体验。

**后端优化：**
- Prisma Role 查询优化：`include: { Role: true }` → `include: { Role: { select: { id, name, type, level } } }`，避免加载 personality/memory/workflows 等 JSON 大字段（meeting-crud.routes.ts 5 处）
- API 启动并行化：sync starters 先执行，然后 `Promise.all` 并行启动 taskWorker/initDiscussionEventHandlers/startHealthMonitor

**前端优化：**
- 路由级代码分割：Home/Tasks 页面从 eager import 改为 `React.lazy()` + Suspense
- Vite 分包策略：vendor-utils 拆分为 vendor-state (zustand) 和 vendor-http (axios)，减少首包体积

### 12.14 UX 打磨：Toast 通知 + 暗色模式 (2026-05-02)

全站 UX 改进，消除阻塞式 alert() 和暗色模式硬编码颜色。

**Toast 通知系统：**
- 自建零依赖 toast（`src/utils/toast.ts`），纯 DOM API + CSS 变量，自动适配暗/亮模式
- API：`toast.success/error/warning/info`，底部右侧弹出，3 秒自动消失
- 替换全站 65 处 `alert()` 调用（24 个文件），消除 UI 线程阻塞
- 修复 ~20 处静默 catch 块（仅 console.error），改为 `toast.error()` 给用户操作反馈

**暗色模式修复（6 组件）：**
| 组件 | 问题 | 修复 |
|------|------|------|
| LoginModal | bg-white, text-gray-700, border-gray-300 | .modal + .input + .btn-primary |
| DeleteConfirmModal | bg-white, text-gray-900, bg-red-100 | .modal + .btn-danger + CSS 变量 |
| PipelineProgress | bg-white, bg-green/red/blue-* | CSS 变量 + rgba 语义色 |
| RationalizationDefense | bg-white, text-gray-*, bg-yellow-* | .modal-overlay + CSS 变量 |
| IronLawAlert | bg-white, text-gray-700, bg-blue-50 | .modal + severity config + CSS 变量 |
| CreateToolStdModal | bg-white, text-gray-* (18 处) | .modal + .input + CSS 变量 |

**Stale Data 修复：**
- PromotionsPage：handleStartReview/handleSubmitReview 成功后追加 `fetchWindowInfo()` 刷新窗口状态

---

## 十三、向后兼容

### 13.1 API 兼容

- 现有 `checkConstraints()`、`checkBeforeExecution()` 接口不变
- 现有 `ConstraintContext` 接口扩展（新增字段可选），不破坏已有调用
- 现有 `IronLaw`/`Guideline` 类型保留为 deprecated alias
- 新增 `knowledge/*` 模块为独立导出路径

### 13.2 渐进式迁移

```
v0.9.0  新增 knowledge/ 模块，约束系统不变
v1.0.0  约束分层（safety/quality），质量约束标记退化计划
v1.1.0  Doctor/Evolver 转型，新旧并存
v2.0.0  移除已退化的质量约束，knowledge 成为主模块
```

### 13.3 导出路径

```json
{
  "exports": {
    ".": "全量导出（兼容）",
    "./knowledge": "知识引擎独立导出",
    "./safety": "安全约束独立导出",
    "./core": "核心约束（兼容）",
    "./presets": "预设配置"
  }
}
```

---

## 十四、设计原则

### 14.1 核心原则

| 原则 | 含义 | 对应模块 |
|------|------|----------|
| **知识驱动** | 一切设计服务于知识的积累和消费 | 全局架构 |
| **为失败而设计** | 异常态，不是例外。每个组件支持容错、重试、优雅降级 | context/, llm/, failure/ |
| **契约优先** | 通过显式接口定义所有交互，模块化和演进的基础 | tools/, llm/adapter.ts |
| **默认安全** | 最小权限、零信任、纵深防御 | safety/, constraints/safety.ts |
| **关注点分离** | 控制平面和数据平面分离，策略和执行分离 | 全局架构 |
| **一切皆可度量** | 每个行为、决策、资源使用都可量化 | monitoring/, dashboard/ |
| **共同进化** | 模型越强，框架越薄。定期删减已被模型内化的能力 | 全局架构 |

### 14.2 共同进化原则

这是最重要的一个。测试标准：如果模型更强了，性能自然提升，而框架复杂度不需要增加，那这个设计就是靠谱的。

harness 需要定期从框架里删减能力，因为新版本模型已经把这些能力内化了。具体操作：
- 监控质量约束的拦截率趋势
- 拦截率持续下降的约束标记为退化候选
- 按 Iron Law → Guideline → Tip → 移除 的路径渐进退化

### 14.3 七个架构抉择

| 抉择 | 选项 | 我们的答案 | 理由 |
|------|------|-----------|------|
| 单Agent vs 多Agent | 单 / 多 | **先榨干单Agent** | 多Agent有额外开销。工具重叠>10或任务域明显分离时才拆 |
| ReAct vs Plan-and-Execute | ReAct / Plan-and-Execute | **默认 Plan-and-Execute** | 异常触发重规划 |
| 上下文管理策略 | 5种 | **全部支持，按场景选择** | 清理/摘要/观察屏蔽/结构化笔记/子Agent委托 |
| 验证循环设计 | 计算/推理 | **两者结合** | 计算验证提供确定性，推理验证抓语义问题 |
| 权限与安全 | 宽松/严格 | **严格模式** | 安全优先，高风险操作需用户确认 |
| 工具范围策略 | 全量/懒加载 | **懒加载** | 当前需要啥暴露啥 |
| 框架厚度 | 厚/薄 | **薄框架 + 模型进化** | 定期删减已被模型内化的能力 |

### 14.4 R.E.S.T 目标对齐

| 目标 | harness 对应 | 度量指标 |
|------|-------------|----------|
| **Reliability** | 检查点恢复、操作幂等、错误分类重试 | 任务成功率、中断恢复率 |
| **Efficiency** | Token 流水线、上下文预算、知识精准注入 | 平均 token 消耗、知识命中率 |
| **Security** | 三层安全护栏、Sandbox 级别、策略网关 | 策略拒绝率、安全事件数 |
| **Traceability** | 引用追踪、成熟度日志、Dashboard | 知识引用覆盖率、决策可解释性 |

---

*本文档随实施持续更新。*
*参考文章：*
- *腾讯 AI Team《Harness 不是目的，知识才是护城河》*
- *phodal《Harness 工程可视化：在 Vibe Coding 中重建工程可控性》*
- *《Agent Harness 上下文管理：聊天记录还是工作集？》*
