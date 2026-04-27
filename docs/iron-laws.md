# Iron Laws（铁律）

> @dommaker/harness 约束框架核心 — 绝对禁止，无例外

---

## 定义

**Iron Laws** 是 AI Agent 执行过程中的绝对底线：

- **绝对禁止** — 违背即阻止执行
- **无例外** — 不允许任何情况绕过
- **机器验证** — 通过代码检查，非人工判断

---

## 五条铁律

### 1. NO BYPASSING CHECKPOINTS

```yaml
id: no_bypass_checkpoint
rule: 禁止跳过检查点验证
trigger: step_execution
```

**原因**：检查点是质量门控，是最后一道防线。

**禁止**：
- "先跳过验证，后面再补"
- "这个检查不重要"

**必须**：
- 所有检查点必须通过
- 失败必须修复，不能跳过

---

### 2. NO SELF APPROVAL WITHOUT TEST EVIDENCE

```yaml
id: no_self_approval
rule: 禁止自评通过，必须提供测试证据
trigger: task_completion_claim
```

**原因**：质量底线，不能由开发者自评。

**禁止**：
- "应该没问题"
- "我测过了"（无证据）
- 标记 `passes: true`（未运行测试）

**必须**：
- 提供测试报告
- 提供覆盖率数据
- 提供 CI 通过记录

---

### 3. NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION

```yaml
id: no_completion_without_verification
rule: 禁止无验证声明完成，必须运行验证命令
trigger: task_completion_claim
```

**原因**：完成声明必须基于新鲜验证。

**禁止**：
- "任务完成了"（未测试）
- "之前测过"（非新鲜）

**必须**：
- 运行 `npm test`
- 运行 `npm run build`
- 运行 CI 流程

---

### 4. NO SIMPLIFYING TESTS TO AVOID DIFFICULTY

```yaml
id: no_test_simplification
rule: 禁止简化测试绕过困难
trigger: test_creation
```

**原因**：测试困难必须解决，不能规避。

**禁止**：
- 为了绕过 mock 困难而删除测试用例
- 为了绕过异步问题而跳过断言
- 降低测试覆盖率要求

**必须**：
- 分析问题（mock？异步？环境？）
- 尝试解决（查文档、搜方案）
- 请求帮助（向用户说明困难）

---

### 5. ONE TASK PER SESSION

```yaml
id: incremental_progress
rule: 禁止一次做多个任务，每次只做一件事
trigger: feature_completion_claim
```

**原因**：避免中途耗尽 context，保持专注和可控。

**禁止**：
- one-shotting（一次做完所有事）
- 并行开发多个功能
- 跨多个领域同时工作

**必须**：
- 一个 session 一个任务
- 完成后验证、提交
- 下一个任务开新 session

---

## 实现

```typescript
import { IRON_LAWS, checkConstraints } from '@dommaker/harness';

// 检查所有铁律
const result = await checkConstraints({
  trigger: 'task_completion_claim',
  files: changedFiles,
});

if (!result.passed) {
  console.error('Iron Law 违规:', result.violations);
}
```

---

## 来源

- Anthropic AI Harness — Effective Harnesses for Long-running Agents
- 工程实践总结 — 质量底线

---

## 参考

- [Constraint 类型定义](../src/types/constraint.ts)
- [Checker 实现](../src/core/constraints/checker.ts)
- [Interceptor 拦截器](../src/core/constraints/interceptor.ts)
