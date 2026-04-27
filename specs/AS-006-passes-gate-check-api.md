# AS-006 PassesGate Check API Spec

## 背景

**问题**：当前 `PassesGate.setPasses()` 需要传入 `workDir`，导致 harness 与业务耦合。

**目标**：提供纯验证接口 `PassesGate.check()`，harness 只负责验证结果，不负责运行测试。

---

## 设计方案

### 架构分层

| 层 | 职责 | 是否需要 workDir |
|---|------|:---------------:|
| **harness** | 纯约束层，验证测试结果 | ❌ 不需要 |
| **Studio** | 业务层，运行测试 + 提供结果 | ✅ 需要 |

### 接口设计

```typescript
// harness/types/passes-gate.ts
interface TestResult {
  passed: boolean;        // 必填：测试是否通过
  command?: string;       // 可选：测试命令（用于记录）
  coverage?: number;      // 可选：覆盖率
  evidence?: string;      // 可选：证据路径
  failures?: string[];    // 可选：失败列表
  output?: string;        // 可选：测试输出
}

interface PassesGateCheckResult {
  allowed: boolean;       // 是否允许标记完成
  violations?: ConstraintViolation[];  // Iron Law 违规
  testResult?: TestResult;  // 原始测试结果
}

// harness/core/validators/passes-gate.ts
class PassesGate {
  /**
   * 验证测试结果（不运行测试）
   * 类似 checkConstraints() 的接口风格
   */
  check(testResult: TestResult): PassesGateCheckResult;
}
```

---

## 验证逻辑

### Iron Law 映射

| Iron Law | 触发条件 | 验证规则 |
|---------|---------|---------|
| **no_self_approval** | `testResult.passed === false` | 禁止自评通过，必须测试通过 |
| **no_completion_without_verification** | `requireEvidence=true && !testResult.evidence` | 必须有测试证据 |

### check() 实现逻辑

```typescript
check(testResult: TestResult): PassesGateCheckResult {
  // 1. 测试未通过 → Iron Law #2
  if (!testResult.passed) {
    return {
      allowed: false,
      violations: [{
        id: 'no_self_approval',
        rule: 'NO SELF APPROVAL WITHOUT TEST EVIDENCE',
        message: '测试未通过',
        level: 'iron_law',
      }],
      testResult,
    };
  }

  // 2. 缺少证据 → Iron Law #3
  if (this.config.requireEvidence && !testResult.evidence) {
    return {
      allowed: false,
      violations: [{
        id: 'no_completion_without_verification',
        rule: 'NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION',
        message: '缺少测试证据',
        level: 'iron_law',
      }],
      testResult,
    };
  }

  // 3. 通过
  return { allowed: true, testResult };
}
```

---

## Studio 集成示例

```typescript
// Studio apps/api/src/modules/tasks/routes.ts
import { PassesGate } from '@dommaker/harness';

const passesGate = new PassesGate({ requireEvidence: true });

taskRoutes.post('/:taskId/complete', async (req, res) => {
  const { taskId } = req.params;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { Project: true },
  });

  // Step 1: Studio 运行测试（决定 workDir 和测试命令）
  const workDir = getProjectWorkDir(task.projectId);
  const testResult = await runTestCommand(workDir);

  // Step 2: harness 验证结果（纯约束层）
  const passesResult = passesGate.check(testResult);

  if (!passesResult.allowed) {
    return res.status(400).json({
      error: 'Iron Law 违规',
      violations: passesResult.violations,
      testResult,
    });
  }

  // Step 3: 完成任务
  const completed = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'completed',
      completedAt: new Date(),
      testEvidence: testResult.evidence,  // 🆕 记录证据
    },
  });

  res.json(completed);
});
```

---

## Acceptance Criteria

### AC-001：PassesGate.check() 接口存在

**验证**：`PassesGate` 类有 `check(testResult: TestResult)` 方法

**测试**：
```typescript
const gate = new PassesGate();
expect(gate.check).toBeDefined();
expect(typeof gate.check).toBe('function');
```

---

### AC-002：测试未通过返回 Iron Law #2 违规

**输入**：`{ passed: false }`

**期望输出**：
```typescript
{
  allowed: false,
  violations: [{
    id: 'no_self_approval',
    rule: 'NO SELF APPROVAL WITHOUT TEST EVIDENCE',
    level: 'iron_law',
  }],
}
```

**测试**：
```typescript
const result = gate.check({ passed: false });
expect(result.allowed).toBe(false);
expect(result.violations?.[0]?.id).toBe('no_self_approval');
```

---

### AC-003：缺少证据返回 Iron Law #3 违规

**配置**：`{ requireEvidence: true }`

**输入**：`{ passed: true, evidence: undefined }`

**期望输出**：
```typescript
{
  allowed: false,
  violations: [{
    id: 'no_completion_without_verification',
    rule: 'NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION',
    level: 'iron_law',
  }],
}
```

**测试**：
```typescript
const gate = new PassesGate({ requireEvidence: true });
const result = gate.check({ passed: true });
expect(result.allowed).toBe(false);
expect(result.violations?.[0]?.id).toBe('no_completion_without_verification');
```

---

### AC-004：测试通过且有证据返回 allowed=true

**配置**：`{ requireEvidence: true }`

**输入**：`{ passed: true, evidence: '/path/to/evidence.log' }`

**期望输出**：`{ allowed: true }`

**测试**：
```typescript
const gate = new PassesGate({ requireEvidence: true });
const result = gate.check({
  passed: true,
  evidence: '/tmp/test-2026-04-27.log',
});
expect(result.allowed).toBe(true);
expect(result.violations).toBeUndefined();
```

---

### AC-005：requireEvidence=false 时允许无证据

**配置**：`{ requireEvidence: false }`

**输入**：`{ passed: true }`

**期望输出**：`{ allowed: true }`

**测试**：
```typescript
const gate = new PassesGate({ requireEvidence: false });
const result = gate.check({ passed: true });
expect(result.allowed).toBe(true);
```

---

### AC-006：TestResult 类型导出

**验证**：`TestResult` 和 `PassesGateCheckResult` 类型可导出

**测试**：
```typescript
import { TestResult, PassesGateCheckResult } from '@dommaker/harness';
const result: TestResult = { passed: true };
const checkResult: PassesGateCheckResult = gate.check(result);
```

---

### AC-007：保留原有 setPasses() 方法（向后兼容）

**验证**：`setPasses()` 方法仍然存在

**测试**：
```typescript
const gate = new PassesGate();
expect(gate.setPasses).toBeDefined();
```

---

## Task Schema 扩展（Studio）

```prisma
model Task {
  // ...existing fields
  testEvidence String?   // 🆕 测试证据路径
}
```

---

## 文件清单

| 文件 | 改动 |
|------|------|
| `harness/types/passes-gate.ts` | 🆕 新增 `TestResult`、`PassesGateCheckResult` 类型 |
| `harness/core/validators/passes-gate.ts` | 🆕 新增 `check()` 方法 |
| `harness/__tests__/passes-gate-check.test.ts` | 🆕 新增测试（AC-001~007） |
| `harness/src/index.ts` | 🔧 导出新类型 |
| `agent-studio/prisma/schema.prisma` | 🆕 Task 增加 `testEvidence` 字段 |
| `agent-studio/apps/api/src/modules/tasks/routes.ts` | 🆕 complete 路由集成 PassesGate.check() |

---

## 工作量估算

| 任务 | 时间 |
|------|:---:|
| harness PassesGate.check() 实现 | 30min |
| harness 测试编写（7 AC） | 20min |
| Studio Task Schema 扩展 | 10min |
| Studio complete 路由集成 | 30min |
| Studio 测试编写 | 20min |
| **总计** | **~2h** |

---

## 依赖关系

| 依赖 | 状态 |
|------|:----:|
| harness PassesGate 类 | ✅ 已存在 |
| Iron Law 定义 | ✅ 已存在 |
| Studio Task model | ✅ 已存在 |

---

## 风险点

| 风险 | 影响 | 缓解措施 |
|------|:----:|---------|
| 向后兼容 | 中 | 保留 `setPasses()` 方法 |
| Studio 需要实现 `runTestCommand()` | 中 | 可先用 mock，后续完善 |

---

## 参考资料

- `/root/projects/harness/src/core/validators/passes-gate.ts`（现有实现）
- `/root/projects/harness/src/types/passes-gate.ts`（现有类型）
- `/root/projects/agent-studio/apps/api/src/modules/tasks/routes.ts`（集成位置）