# AS-007 ReviewGate 集成到 PR 创建 Spec

## 背景

**问题**：Studio PR 创建后缺少审查状态验证

**目标**：PR 创建后使用 ReviewGate 验证审查状态，确保符合 Iron Law 要求

---

## 设计方案

### 架构分层

| 层 | 职责 |
|---|------|
| **harness ReviewGate** | 纯验证层，检查 PR 审查状态 |
| **Studio** | 业务层，创建 PR + 提供上下文 |

### 集成位置

```
tasks/routes.ts: createPullRequest()
  → gh pr create
  → ReviewGate.check()（可选验证）
```

---

## ReviewGate 接口（已存在）

```typescript
// harness/gates/review.ts
class ReviewGate {
  constructor(config?: ReviewGateConfig);
  
  async check(context: GateContext): Promise<GateResult>;
}

interface GateContext {
  projectId: string;
  projectPath: string;    // 必填
  prNumber?: number;      // 可选（创建后填写）
}

interface ReviewGateConfig {
  minReviewers: number;
  requireApproval: boolean;
  blockOnChangesRequested: boolean;
}
```

---

## Studio 集成示例

```typescript
// Studio apps/api/src/modules/tasks/routes.ts
import { ReviewGate } from '@dommaker/harness';
import type { GateContext } from '@dommaker/harness';

async function createPullRequest(project: Project): Promise<PRResult> {
  // 1. 创建 PR
  const ghCommand = `gh pr create --repo ${repo} --head ${branch} --base main --title "${title}" --body "${body}"`;
  const result = execSync(ghCommand, { encoding: 'utf-8' });
  
  const match = result.match(/https:\/\/github\.com\/.+\/pull\/(\d+)/);
  const prNumber = match ? parseInt(match[1]) : 0;
  
  // 2. ReviewGate 验证（创建后检查）
  const reviewGate = new ReviewGate({
    minReviewers: 1,
    requireApproval: false,  // 创建时无需审批
    blockOnChangesRequested: false,
  });
  
  const gateContext: GateContext = {
    projectId: project.id,
    projectPath: getProjectWorkDir(project.id),
    prNumber,
  };
  
  const reviewResult = await reviewGate.check(gateContext);
  
  logger.info({ prNumber, reviewResult }, 'ReviewGate checked');
  
  // 3. 返回结果（包含审查状态）
  return {
    url: match?.[0] || '',
    number: prNumber,
    reviewStatus: reviewResult,
  };
}
```

---

## Acceptance Criteria

### AC-001：createPullRequest 调用 ReviewGate.check()

**验证**：PR 创建后调用 ReviewGate

**测试**：
```typescript
// 验证 reviewGate.check 被调用
expect(reviewGate.check).toHaveBeenCalledWith({
  projectId: 'test-project',
  projectPath: '/tmp/project',
  prNumber: 123,
});
```

---

### AC-002：PR 创建返回审查状态

**验证**：返回结果包含 `reviewStatus`

**测试**：
```typescript
const result = await createPullRequest(project);
expect(result.reviewStatus).toBeDefined();
expect(result.reviewStatus.gate).toBe('review');
```

---

### AC-003：ReviewGate 配置从环境变量读取

**配置**：
```bash
REVIEW_GATE_MIN_REVIEWERS=1
REVIEW_GATE_REQUIRE_APPROVAL=false
REVIEW_GATE_BLOCK_ON_CHANGES_REQUESTED=true
```

**测试**：
```typescript
const reviewGate = new ReviewGate({
  minReviewers: parseInt(process.env.REVIEW_GATE_MIN_REVIEWERS || '1'),
  requireApproval: process.env.REVIEW_GATE_REQUIRE_APPROVAL === 'true',
  blockOnChangesRequested: process.env.REVIEW_GATE_BLOCK_ON_CHANGES_REQUESTED === 'true',
});
```

---

### AC-004：本地项目路径获取

**问题**：ReviewGate 需要 `projectPath`

**方案**：环境变量 `PROJECT_WORKDIRS` 或默认 `~/projects/{pmoNumber}`

```typescript
function getProjectWorkDir(projectId: string): string {
  // 方案 A: 默认规则
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  return `~/projects/${project.pmoNumber}`;
  
  // 方案 B: 配置映射
  const workDirs = JSON.parse(process.env.PROJECT_WORKDIRS || '{}');
  return workDirs[projectId] || `~/projects/${project.pmoNumber}`;
}
```

---

### AC-005：ReviewGate.check() 失败不阻断 PR 创建

**原因**：PR 创建时通常没有审批，只记录状态

**测试**：
```typescript
const result = await createPullRequest(project);
// 即使 reviewResult.passed = false，PR 仍创建成功
expect(result.url).toBeDefined();
expect(result.reviewStatus.passed).toBe(false);  // 新 PR 无审批
```

---

### AC-006：日志记录审查状态

**验证**：logger.info 记录 reviewResult

**测试**：
```typescript
expect(logger.info).toHaveBeenCalledWith(
  { prNumber: 123, reviewResult: expect.any(Object) },
  'ReviewGate checked'
);
```

---

## Task Schema 扩展

```prisma
model Task {
  // ...existing fields
  reviewStatus String?   // 🆕 审查状态（JSON）
}
```

---

## 文件清单

| 文件 | 改动 |
|------|------|
| `agent-studio/apps/api/src/modules/tasks/routes.ts` | 🆕 createPullRequest 集成 ReviewGate |
| `agent-studio/prisma/schema.prisma` | 🆕 Task 增加 `reviewStatus` 字段（可选） |
| `agent-studio/apps/api/__tests__/review-gate.test.ts` | 🆕 新增测试（AC-001~006） |

---

## 工作量估算

| 任务 | 时间 |
|------|:---:|
| Studio createPullRequest 集成 | 30min |
| 测试编写（6 AC） | 20min |
| Task Schema 扩展（可选） | 10min |
| **总计** | **~1h** |

---

## 依赖关系

| 依赖 | 状态 |
|------|:----:|
| harness ReviewGate 类 | ✅ 已存在 |
| Studio createPullRequest 函数 | ✅ 已存在（FL-017） |

---

## agent-platform 是否集成

**不需要**

| 原因 | 说明 |
|------|------|
| runtime 不负责 PR | Studio only |
| gate-checker 支持 | runtime 有 gate-checker，但不创建 PR |
| Roadmap 分析 | AS-007 是 Studio 任务 |

---

## 风险点

| 风险 | 影响 | 缓解措施 |
|------|:----:|---------|
| projectPath 获取 | 中 | 使用默认规则或配置映射 |
| gh CLI 不可用 | 低 | ReviewGate 已处理错误 |

---

## 参考资料

- `/root/projects/harness/src/gates/review.ts`（现有实现）
- `/root/projects/agent-studio/apps/api/src/modules/tasks/routes.ts`（集成位置）
- `/root/projects/agent-studio/docs/roadmap.md`（AS-007 定义）