# harness 落地方案：复用 vs 新建

调研时间：2026-04-27
目的：分析如何把已有实现整合到 harness

---

## 一、已实现功能对比

| HZ 任务 | 需要功能 | 已实现位置 | 状态 |
|--------|---------|-----------|:----:|
| **HZ-027** | Multi-agent Orchestrator | `runtime/orchestration/orchestrator.ts` | ✅ 已实现 |
| **HZ-026** | Built-in Toolset（14工具）| `runtime/executors/tool.ts` | ✅ 已实现 |
| **HZ-005** | Agentic Loop | `runtime/core/executor.ts` | ⚠️ 需检查 |
| **HZ-006** | State Management | `runtime/context/` | ⚠️ 需检查 |
| **HZ-011** | Tools Registry | `runtime/executors/tool.ts` | ✅ 部分 |
| **HZ-023** | Environment | ❌ 无对应 | ❌ 需新建 |
| **HZ-024** | Agent Manager | ❌ 无对应 | ❌ 需新建 |

---

## 二、runtime 已实现模块

### 1. Orchestrator（HZ-027 ✅）

**文件**：`packages/runtime/src/orchestration/orchestrator.ts`

**核心功能**：
```typescript
export class Orchestrator {
  // 多角色协作编排
  async execute(config: OrchestrationConfig): Promise<OrchestrationResult>
  
  // 会议事件驱动
  async handleMeetingEvent(event: MeetingEvent)
  
  // 上下文共享
  private meetingContextSharer: ContextSharer
  
  // 角色调度
  private roleScheduler: RoleScheduler
}
```

**已支持**：
- 多角色协作（architect → frontend-dev/backend-dev → qa）
- 会议事件订阅（meeting.started/decision/ended）
- 角色优先级 + waitFor（依赖关系）
- 上下文共享（ContextSharer）

---

### 2. Tool Executor（HZ-026 ✅）

**文件**：`packages/runtime/src/executors/tool.ts`

**内置工具集（14 个）**：
| 工具 | 说明 |
|------|------|
| `spawn-codex` | 调用 Codex |
| `file-read` | 文件读取 |
| `file-write` | 文件写入 |
| `file-copy` | 文件复制 |
| `git-clone` | Git 克隆 |
| `git-branch` | Git 分支创建 |
| `git-checkout` | Git 分支切换 |
| `git-status` | Git 状态检查 |
| `git-commit` | Git 提交 |
| `git-push` | Git 推送 |
| `npm-install` | npm 安装 |
| `npm-run` | npm 脚本执行 |
| `docker-build` | Docker 构建（定义未实现）|
| `docker-run` | Docker 运行（定义未实现）|

**架构**：
```typescript
// 内置工具 + 外部脚本
async function executeTool(name, input, context) {
  if (isBuiltinTool(name)) {
    return executeBuiltinTool(tool, input, context);
  } else {
    return executeScript(tool, input, context);
  }
}
```

---

### 3. 其他已实现模块

| 文件 | 说明 | 复用价值 |
|------|------|:-------:|
| `orchestration/context-sharer.ts` | 上下文共享 | ✅ 高 |
| `orchestration/role-scheduler.ts` | 角色调度 | ✅ 高 |
| `orchestration/meeting-subscriber.ts` | 会议事件订阅 | ✅ 高 |
| `executors/spawn.ts` | spawn-codex | ✅ 高 |
| `executors/evolution.ts` | 演化机制 | ⚠️ 中 |
| `executors/governance.ts` | 治理机制 | ⚠️ 中 |
| `executors/understand.ts` | 理解机制 | ⚠️ 中 |

---

## 三、整合方案

### 方案 A：runtime → harness 导出（推荐）

**思路**：runtime 实现核心功能，harness 提供约束接口

**架构**：
```
agent-runtime（执行引擎）
├── orchestration/（已实现）
│   ├── orchestrator.ts ← HZ-027
│   ├── context-sharer.ts ← HZ-006 部分
│   ├── role-scheduler.ts ← HZ-009 部分
│   └── meeting-subscriber.ts ← HZ-028 部分
│
├── executors/（已实现）
│   ├── tool.ts ← HZ-026
│   ├── spawn.ts ← HZ-010
│   ├── evolution.ts ← HZ-016 部分
│   └── governance.ts ← HZ-017 部分
│
└── core/（已实现）
    ├── executor.ts ← HZ-005（需检查）
    └── events.ts ← HZ-028 部分

harness（约束接口）
├── Import runtime modules
│   import { Orchestrator } from '@dommaker/runtime'
│   import { executeTool } from '@dommaker/runtime'
│
├── Add constraint layer
│   ├── Iron Laws（核心优势）
│   ├── PassesGate（核心优势）
│   ├── ReviewGate（核心优势）
│   └── Constraint Checker（HZ-002）
│
└── Wrap runtime with constraints
    ├── ConstrainedOrchestrator（包装）
    ├── ConstrainedToolExecutor（包装）
    └── ConstrainedExecutor（包装）
```

---

### 方案 B：harness 直接引用 runtime（简单）

**思路**：harness 不新建，直接引用 runtime

**代码示例**：
```typescript
// harness/src/core/orchestration/wrapped-orchestrator.ts
import { Orchestrator } from '@dommaker/runtime';

export class ConstrainedOrchestrator extends Orchestrator {
  async execute(config: OrchestrationConfig): Promise<OrchestrationResult> {
    // 1. 先检查约束
    await harness.checkConstraints({
      trigger: 'orchestration.execute',
      executionId: config.executionId,
    });
    
    // 2. 调用 runtime 实现
    const result = await super.execute(config);
    
    // 3. 验证结果（PassesGate）
    const verified = await harness.passesGate.verify(result);
    
    if (!verified.passed) {
      throw new ConstraintViolationError('PassesGate failed');
    }
    
    return result;
  }
}
```

---

### 方案 C：agent-platform 重构（激进）

**思路**：把 runtime + harness 合并为一个包

**架构**：
```
agent-platform（合并后）
├── packages/runtime/
│   ├── orchestration/（保留）
│   ├── executors/（保留）
│   └── core/（保留）
│
├── packages/harness/
│   ├── constraints/（新增）
│   ├── gates/（新增）
│   └── orchestration/（包装 runtime）
│
└── packages/integration/
    ├── studio-adapter（Studio 适配）
    └── runtime-adapter（Runtime 适配）
```

---

## 四、落地建议

### Phase 1：整合已实现模块（~4h）

| 任务 | 工作量 | 说明 |
|------|:-----:|------|
| **HZ-027 复用** | 1h | 包装 Orchestrator + 约束检查 |
| **HZ-026 复用** | 1h | 包装 ToolExecutor + 约束检查 |
| **HZ-005 复用** | 1h | 包装 Executor + Agentic Loop |
| **HZ-006 复用** | 1h | 包装 ContextSharer + State |

**代码示例**：
```typescript
// harness/src/runtime-adapter/index.ts
export { Orchestrator } from '@dommaker/runtime';
export { executeTool } from '@dommaker/runtime';
export { ContextSharer } from '@dommaker/runtime';
export { RoleScheduler } from '@dommaker/runtime';

// 包装版本
export { ConstrainedOrchestrator } from './wrapped-orchestrator';
export { ConstrainedToolExecutor } from './wrapped-tool-executor';
```

---

### Phase 2：新建缺失模块（~8h）

| 任务 | 工作量 | 说明 |
|------|:-----:|------|
| **HZ-023 Environment** | 3h | 新建（runtime 无对应）|
| **HZ-024 Agent Manager** | 3h | 新建（runtime 无对应）|
| **HZ-025 Agent Version Control** | 2h | 新建 |

---

### Phase 3：完善约束层（~6h）

| 任务 | 工作量 | 说明 |
|------|:-----:|------|
| **HZ-002 checker.ts** | 4h | 实现核心检查逻辑 |
| **HZ-003 PassesGate/ReviewGate** | 2h | 完善验证逻辑 |

---

## 五、Roadmap 调整（复用后）

| Phase | 原任务数 | 复用后 | 工作量 |
|:-----:|:-------:|:-----:|:-----:|
| **P0** | 1 | 1 | 10分钟 |
| **P1** | 4 | 2 | ~5h |
| **P2** | 3 | 2 | ~5h |
| **P3** | 20 | 12 | ~24h |
| **P4** | 4 | 4 | ~18h |
| **总计** | 28 | **21** | **~52h** |

---

## 六、复用任务清单

| HZ 任务 | 复用来源 | 工作量 | 状态 |
|--------|---------|:-----:|:----:|
| **HZ-027** | runtime/orchestrator.ts | 1h | ✅ 复用 |
| **HZ-026** | runtime/executors/tool.ts | 1h | ✅ 复用 |
| **HZ-005** | runtime/core/executor.ts | 1h | ⚠️ 需检查 |
| **HZ-006** | runtime/context/ | 1h | ⚠️ 需检查 |
| **HZ-009** | runtime/role-scheduler.ts | 0.5h | ✅ 复用 |
| **HZ-011** | runtime/executors/tool.ts | 0.5h | ✅ 复用 |
| **HZ-028** | runtime/core/events.ts | 0.5h | ✅ 复用 |

---

## 七、新建任务清单

| HZ 任务 | 原因 | 工作量 | 状态 |
|--------|------|:-----:|:----:|
| **HZ-023** | runtime 无 Environment | 3h | ❌ 新建 |
| **HZ-024** | runtime 无 Agent Manager | 3h | ❌ 新建 |
| **HZ-025** | runtime 无 Version Control | 2h | ❌ 新建 |
| **HZ-002** | harness 核心优势 | 4h | ❌ 新建 |
| **HZ-003** | harness 核心优势 | 2h | ❌ 新建 |

---

## 八、结论

### 关键发现

1. **HZ-027（Multi-agent）** ✅ 已在 runtime 实现
2. **HZ-026（Toolset）** ✅ 已在 runtime 实现（14 工具）
3. **HZ-023/024/025** ❌ runtime 无对应，需新建
4. **HZ-002/003** ❌ harness 核心优势，必须新建

### 整合策略

**推荐方案 A**：runtime → harness 导出

**理由**：
- runtime 已实现核心功能（Orchestrator + ToolExecutor）
- harness 提供约束接口（Iron Laws + PassesGate）
- 分离关注点（执行 vs 约束）
- 避免重复开发

### 调整 Roadmap

**原 Roadmap**：28 任务、~68h

**复用后 Roadmap**：
- 复用：7 任务、~5h
- 新建：14 任务、~47h
- 总计：21 任务、~52h

---

## 九、下一步行动

### Phase 1（本周）

| ID | 任务 | 工作量 | 说明 |
|----|------|:-----:|------|
| **HZ-001** | 修复测试 | 10分钟 | P0 |
| **HZ-002** | checker.ts | 4h | 新建 |
| **HZ-027 复用** | 包装 Orchestrator | 1h | 复用 runtime |
| **HZ-026 复用** | 包装 ToolExecutor | 1h | 复用 runtime |

---

**一句话**：

> **runtime 已实现 HZ-027 + HZ-026，应复用而非新建。**
> 
> **harness 核心价值是约束（HZ-002 + HZ-003），必须新建。**
> 
> **整合策略：runtime 执行 + harness 约束 + 包装层。**