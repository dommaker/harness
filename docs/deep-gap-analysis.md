# harness 深度对比分析：遗漏优化点

调研时间：2026-04-27
目的：找出三篇文章对比中遗漏的优化点

---

## 一、已列入 Roadmap 的任务

| ID | 任务 | 来源 | 状态 |
|----|------|------|:----:|
| **HZ-001** | 修复测试失败 | — | ⏳ |
| **HZ-002** | checker.ts 核心检查 | Twitter #9 | ⏳ |
| **HZ-003** | PassesGate/ReviewGate | Twitter #10 | ⏳ |
| **HZ-004** | 测试覆盖 | — | ⏳ |
| **HZ-005** | Agentic Loop | Twitter #1 + Claude Ring 2 | ⏳ |
| **HZ-006** | State Management | Twitter #7 | ⏳ |
| **HZ-007** | Error Handling | Twitter #8 + Claude Ring 4 | ⏳ |
| **HZ-008** | Tool Runner SDK | Claude Ring 5 | ⏳ |
| **HZ-009** | Parallel Calls | Claude Ring 3 | ⏳ |

---

## 二、遗漏的优化点（Twitter 文章）

| # | 组件 | harness 现状 | 优先级 | 工作量 | 建议 |
|---|------|:-----------:|:-----:|:-----:|------|
| **2** | **Tools** | ❌ 未实现 | P3 | 4h | 工具注册、验证、执行、结果格式化 |
| **5** | **Prompt Construction** | ❌ 未实现 | P3 | 2h | 层级构造（system + tools + memory + history + user）|
| **6** | **Output Parsing** | ❌ 未实现 | P3 | 2h | Native tool calling / structured output |
| **11** | **Subagent Orchestration** | ❌ 未实现 | P4 | 4h | Fork、Teammate、Worktree 模式 |
| **12** | **Lifecycle Management** | ⚠️ 部分 | P3 | 2h | 完整 session 管理 + trace 可视化 |

---

## 三、遗漏的优化点（Claude Tool Use）

| Ring | 特性 | harness 现状 | 优先级 | 工作量 | 建议 |
|:----:|------|:-----------:|:-----:|:-----:|------|
| **1** | Single tool, single turn | ❌ 未实现 | P2 | 1h | 最小执行流程（参考 Ring 1）|
| — | **Tool Schema Definition** | ❌ 未实现 | P3 | 2h | JSON Schema + @beta_tool decorator |
| — | **Tool Result Formatting** | ⚠️ 部分 | P3 | 1h | tool_result block + tool_use_id matching |
| — | **Conversation History** | ⚠️ 部分 | P3 | 1h | messages 数组管理（append + append）|

---

## 四、遗漏的优化点（Kimi 对比）

| 维度 | Kimi 特性 | harness 现状 | 优先级 | 工作量 | 建议 |
|------|----------|:-----------:|:-----:|:-----:|------|
| **Proactive Agents** | 24/7 持续运行 | ❌ 未实现 | P4 | 4h | 后台持续监控 + 自动触发 |
| **Agent Swarm** | 300 agents 并行 | ❌ 未实现 | P4 | 6h | 大规模并行调用 |
| **Self-Organizing** | 自动创建角色 | ❌ 未实现 | P4 | 3h | 动态角色分配 |

---

## 五、harness 已有但未充分利用的模块

| 文件 | 说明 | 当前状态 | 建议 |
|------|------|:-------:|------|
| **constraint-doctor.ts** | Agent 深度分析 | ⚠️ 未完全实现 | P3 完善（调用 Agent 诊断）|
| **constraint-evolver.ts** | 约束自动进化 | ⚠️ 未完全实现 | P3 完善（自适应约束）|
| **cross-project-checker.ts** | 跨项目检查 | ⚠️ 未启用 | P3 启用（多项目约束）|
| **traces.ts** | Trace 记录 | ⚠️ 部分 | P3 完善（time-travel debugging）|
| **performance-collector.ts** | 性能数据收集 | ⚠️ 未启用 | P3 启用（性能监控）|

---

## 六、新增任务（补充到 Roadmap）

### 优先级 P2（中等重要）

| ID | 任务 | 来源 | 工作量 |
|----|------|------|:-----:|
| **HZ-010** | Single Tool Execution（Ring 1 基础）| Claude | 1h |

### 优先级 P3（可选）

| ID | 任务 | 来源 | 工作量 |
|----|------|------|:-----:|
| **HZ-011** | Tools 注册 + 验证 + 执行 | Twitter #2 | 4h |
| **HZ-012** | Prompt Construction（层级构造）| Twitter #5 | 2h |
| **HZ-013** | Output Parsing（Native tool calling）| Twitter #6 | 2h |
| **HZ-014** | Lifecycle Management（完整 session）| Twitter #12 | 2h |
| **HZ-015** | constraint-doctor 完善（Agent 诊断）| harness 已有 | 3h |
| **HZ-016** | constraint-evolver 完善（自适应约束）| harness 已有 | 3h |
| **HZ-017** | cross-project-checker 启用 | harness 已有 | 1h |
| **HZ-018** | Time-travel Debugging（traces.ts）| Twitter #7 | 2h |
| **HZ-019** | Performance Monitoring（启用 collector）| Twitter #12 | 1h |

### 优先级 P4（长期）

| ID | 任务 | 来源 | 工作量 |
|----|------|------|:-----:|
| **HZ-020** | Subagent Orchestration（Fork/Worktree）| Twitter #11 | 4h |
| **HZ-021** | Proactive Agents（24/7 运行）| Kimi | 4h |
| **HZ-022** | Agent Swarm（大规模并行）| Kimi | 6h |

---

## 七、完整 Roadmap（更新）

| Phase | 任务 | 工作量 |
|:-----:|------|:-----:|
| **P0** | HZ-001：修复测试 | 10分钟 |
| **P1** | HZ-002 + HZ-005 + HZ-010 | 9h |
| **P2** | HZ-003 + HZ-006 + HZ-007 | 9h |
| **P3** | HZ-004 + HZ-008 + HZ-009 + HZ-011~019 | 26h |
| **P4** | HZ-020~022（长期）| 14h |
| **总计** | — | **~58h** |

---

## 八、关键遗漏点分析

### 1. Tools (#2) — **核心缺失**

**Twitter 文章定义**：
- 工具注册（schema + handler）
- 工具验证（输入验证）
- 工具执行（调用 handler）
- 结果格式化（tool_result block）

**harness 缺失**：
- 无 Tools 模块
- agent-runtime 负责 Tool 执行
- harness 只约束，不执行

**建议**：
- harness 提供 Tools 注册 + 验证接口
- agent-runtime 负责执行
- 分离关注点

---

### 2. Prompt Construction (#5) — **关键缺失**

**Twitter 文章定义**：
```
层级构造：
system prompt
    ↓
tools description
    ↓
memory（CLAUDE.md、MEMORY.md）
    ↓
conversation history
    ↓
user input
```

**harness 缺失**：
- 无 Prompt 模块
- progressive-loader 只加载 context
- 无层级构造

**建议**：
- 新增 PromptBuilder 模块
- 整合 progressive-loader
- 层级构造 + 缓存

---

### 3. Output Parsing (#6) — **关键缺失**

**Twitter 文章定义**：
- Native tool calling（Claude Opus 4.5+）
- Structured output（JSON Schema）
- Output validation

**harness 缺失**：
- 无 Output Parsing
- 依赖 agent-runtime
- 无 structured output 支持

**建议**：
- 新增 OutputParser 模块
- 支持 JSON Schema validation
- 整合 constraintChecker

---

### 4. Subagent Orchestration (#11) — **长期优化**

**Twitter 文章定义**：
- Fork：创建子 agent
- Teammate：协作模式
- Worktree：隔离工作目录
- Handoffs：任务交接

**harness 缺失**：
- 无 Subagent 模块
- Studio 有角色讨论，但无 Orchestration

**建议**：
- P4 实现
- 整合 Studio 角色领取机制

---

### 5. constraint-doctor.ts — **已有未完善**

**当前实现**：
```typescript
// src/monitoring/constraint-doctor.ts
async diagnose(): Promise<DiagnosisResult> {
  // TODO: 调用 Agent 进行深度分析
}
```

**建议完善**：
```typescript
async diagnose(): Promise<DiagnosisResult> {
  const agent = await this.agentClient.create({
    model: 'claude-opus-4.5',
    prompt: `分析以下约束违规的原因...`,
  });
  
  return {
    rootCause: await agent.execute(),
    suggestions: await agent.suggest(),
    autoFix: await agent.proposeFix(),
  };
}
```

---

### 6. constraint-evolver.ts — **已有未完善**

**当前实现**：
```typescript
// src/monitoring/constraint-evolver.ts
async evolve(): Promise<void> {
  // TODO: 根据历史数据自动调整约束
}
```

**建议完善**：
```typescript
async evolve(): Promise<void> {
  const history = await this.loadHistory();
  const patterns = await this.detectPatterns(history);
  
  // 自适应调整
  for (const pattern of patterns) {
    if (pattern.violationRate > 0.3) {
      await this.addException(pattern.constraintId, pattern.context);
    }
  }
}
```

---

## 九、整合建议

### 架构更新

```
harness（完整 Agent Harness）
├── Orchestration Layer
│   ├── Agentic Loop（HZ-005）
│   ├── Tool Runner SDK（HZ-008）
│   ├── Parallel Calls（HZ-009）
│   ├── Single Tool Execution（HZ-010）← 新增
│   └── Tools Registry（HZ-011）← 新增
│
├── Prompt Layer ← 新增
│   ├── Prompt Construction（HZ-012）
│   └── Progressive Loader（已有）
│
├── Output Layer ← 新增
│   ├── Output Parsing（HZ-013）
│   └── Structured Output
│
├── Constraint Layer（已有）
│   ├── Iron Laws
│   ├── PassesGate
│   ├── ReviewGate
│   ├── Constraint Checker（HZ-002）
│   ├── Constraint Doctor（HZ-015）← 完善
│   └── Constraint Evolver（HZ-016）← 完善
│
├── State Layer
│   ├── Checkpointing（HZ-006）
│   ├── Resume
│   └── Time-travel Debugging（HZ-018）← 新增
│
├── Error Layer
│   ├── Error Classification（HZ-007）
│   └── Retry Logic
│
├── Cross-project Layer ← 新增
│   ├── Cross-project Checker（HZ-017）
│   └── Multi-project Constraints
│
├── Monitoring Layer
│   ├── Trace Analysis
│   ├── Performance Collector（HZ-019）← 启用
│   └── Anomaly Detection
│
├── Lifecycle Layer
│   ├── Session Management（HZ-014）
│   └── Lifecycle Hooks
│
└── Advanced Layer（P4）
    ├── Subagent Orchestration（HZ-020）
    ├── Proactive Agents（HZ-021）
    └── Agent Swarm（HZ-022）
```

---

## 十、工作量对比

| 对比项 | 之前 Roadmap | 补充后 Roadmap |
|:------:|:-----------:|:-------------:|
| **任务数** | 9 | 22 |
| **工作量** | ~26h | ~58h |
| **新增** | — | 13 任务（+32h）|

---

## 十一、结论

### 遗漏的核心点

| 类别 | 遗漏点 | 优先级 |
|------|--------|:-----:|
| **Twitter** | #2 Tools + #5 Prompt + #6 Output | P3 |
| **Twitter** | #11 Subagent + #12 Lifecycle | P3-P4 |
| **Claude** | Ring 1（最小流程）| P2 |
| **Kimi** | Proactive + Swarm | P4 |
| **harness 已有** | Doctor + Evolver + Cross-project | P3 |

### 建议实施顺序

```
Phase 1（P0-P1）：夯实核心
    ↓
HZ-001（修复）+ HZ-002（检查）+ HZ-005（Loop）+ HZ-010（最小流程）
    ↓
Phase 2（P2）：完善 Gate + State
    ↓
HZ-003 + HZ-006 + HZ-007
    ↓
Phase 3（P3）：扩展 Layers
    ↓
HZ-004 + HZ-008~019（26h）
    ↓
Phase 4（P4）：高级特性
    ↓
HZ-020~022（长期）
```

---

## 十二、最终 Roadmap（完整）

| ID | 任务 | 优先级 | 工作量 |
|----|------|:-----:|:-----:|
| **HZ-001** | 修复测试失败 | P0 | 10分钟 |
| **HZ-002** | checker.ts 核心检查 | P1 | 4h |
| **HZ-005** | Agentic Loop | P1 | 4h |
| **HZ-010** | Single Tool Execution | P1 | 1h |
| **HZ-003** | PassesGate/ReviewGate | P2 | 3h |
| **HZ-006** | State Management | P2 | 4h |
| **HZ-007** | Error Handling | P2 | 2h |
| **HZ-004** | 测试覆盖 | P3 | 6h |
| **HZ-008** | Tool Runner SDK | P3 | 3h |
| **HZ-009** | Parallel Calls | P3 | 2h |
| **HZ-011** | Tools Registry | P3 | 4h |
| **HZ-012** | Prompt Construction | P3 | 2h |
| **HZ-013** | Output Parsing | P3 | 2h |
| **HZ-014** | Lifecycle Management | P3 | 2h |
| **HZ-015** | constraint-doctor 完善 | P3 | 3h |
| **HZ-016** | constraint-evolver 完善 | P3 | 3h |
| **HZ-017** | cross-project-checker 启用 | P3 | 1h |
| **HZ-018** | Time-travel Debugging | P3 | 2h |
| **HZ-019** | Performance Monitoring | P3 | 1h |
| **HZ-020** | Subagent Orchestration | P4 | 4h |
| **HZ-021** | Proactive Agents | P4 | 4h |
| **HZ-022** | Agent Swarm | P4 | 6h |
| **总计** | — | — | **~58h** |

---

**一句话**：之前 Roadmap 遗漏了 Tools (#2)、Prompt (#5)、Output (#6)、Subagent (#11)、Lifecycle (#12) + harness 已有模块（Doctor、Evolver、Cross-project）。补充后总计 22 任务、~58h。