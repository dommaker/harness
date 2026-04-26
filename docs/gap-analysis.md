# harness 查漏补缺分析

调研时间：2026-04-26

---

## 一、问题汇总

### 1. 测试失败（🔴 紧急）

```
iron-laws.test.ts:
  Expected: 17 constraints
  Received: 18 constraints
  
原因：新增了 incremental_progress (Iron Law #5)，但测试未更新
```

### 2. TODO 未实现（🔴 核心）

| 文件 | TODO 数量 | 重要性 | 说明 |
|------|:--------:|:------:|------|
| **checker.ts** | 6 | 🔴 核心 | Iron Law 检查逻辑空壳 |
| **check.ts** | 4 | 🟡 重要 | 状态检查未实现 |
| **constraint-engine.ts** | 1 | 🟡 重要 | 模块边界检查 |
| **constraint-doctor.ts** | 1 | 🟢 可选 | Agent 深度分析 |
| **report.ts** | 1 | 🟢 可选 | 实际检查数据 |

**checker.ts 核心问题**：
```typescript
// 所有 Iron Law 检查都是空壳，返回 true
case 'no_bypass_checkpoint':
  // TODO: 检查是否跳过了检查点
  return true;

case 'no_test_simplification':
  // TODO: 检查是否简化了测试
  return true;
```

### 3. 测试覆盖率低（🟡 重要）

| 指标 | 数值 | 说明 |
|------|:----:|------|
| **源文件** | 66 | .ts 文件 |
| **测试文件** | 7 | .test.ts 文件 |
| **覆盖率** | ~10% | 极低 |

**缺失测试的关键模块**：
- gates/（门禁系统）
- core/constraints/checker.ts（核心检查）
- cli/commands/（CLI 命令）
- monitoring/（监控系统）

### 4. Gate 未完全实现（🟡 重要）→ ❌ 信息过时（2026-04-27 更正）

> **更正**：Gate 已完整实现，gap-analysis.md 信息过时

| Gate | 文件 | 实现状态 | 测试状态 |
|------|------|:-------:|:--------:|
| **PassesGate** | validators/passes-gate.ts | ✅ 完整 | ⚠️ 只有 extension 测试 |
| **ReviewGate** | gates/review.ts | ✅ 完整 | ❌ 无测试 |
| **SecurityGate** | gates/security.ts | ✅ 完整 | ❌ 无测试 |
| **CheckpointValidator** | validators/checkpoint.ts | ✅ 完整（13种检查）| ❌ 无测试 |

**HZ-003 新任务**：创建 Gate 测试

---

## 二、优化优先级

### P0：修复测试失败（~10 分钟）

| 任务 | 说明 |
|------|------|
| **修复 iron-laws.test.ts** | 更新 constraint 数量为 18 |

### P1：实现核心检查逻辑（~4 小时）

| 文件 | TODO | 实现 |
|------|------|------|
| **checker.ts** | `no_bypass_checkpoint` | 检查是否有 `skip`、`bypass` 关键词 |
| **checker.ts** | `no_test_simplification` | 检查是否有删除测试的 commit |
| **checker.ts** | `no_any_type` | grep `any` 类型 |
| **checker.ts** | `capability_sync` | 检查 CAPABILITIES.md 是否更新 |
| **checker.ts** | `test_coverage_required` | 读取 coverage 报告 |
| **checker.ts** | `no_simplification_without_approval` | 检查简化关键词 |

### P2：完善 Gate 实现（~3 小时）

| Gate | 实现 |
|------|------|
| **PassesGate** | 真实调用 `npm test` |
| **ReviewGate** | 调用 `gh pr status` |
| **SecurityGate** | 调用 `npm audit` |
| **CheckpointValidator** | 检查 checkpoint 文件 |

### P3：增加测试覆盖（~6 小时）

| 模块 | 新增测试 |
|------|---------|
| **checker.ts** | 每个 Iron Law 的测试 |
| **gates/** | 每个 Gate 的测试 |
| **cli/commands/** | 每个命令的测试 |

---

## 三、实现方案

### 修复测试失败（P0）

```typescript
// src/__tests__/iron-laws.test.ts
it('should get all constraints', () => {
  const all = getAllConstraints();
  expect(all.length).toBe(18); // 5 Iron Laws + 10 Guidelines + 2 Tips + 1 (incremental_progress)
});
```

### 实现核心检查逻辑（P1）

```typescript
// src/core/constraints/checker.ts
case 'no_bypass_checkpoint':
  // 检查代码中是否有 skip/bypass 关键词
  const code = await readFile(filePath);
  if (code.includes('skip') || code.includes('bypass') || code.includes('.skip(')) {
    return false; // 违反 Iron Law
  }
  return true;

case 'no_test_simplification':
  // 检查 git diff 是否删除了测试
  const diff = await execAsync('git diff --cached');
  if (diff.includes('-test') || diff.includes('-it(') || diff.includes('-expect(')) {
    return false;
  }
  return true;

case 'no_any_type':
  // grep any 类型
  const { stdout } = await execAsync('grep -r ": any" src --include="*.ts"');
  return stdout.trim().length === 0;

case 'capability_sync':
  // 检查 CAPABILITIES.md 是否更新
  const capabilitiesExists = fs.existsSync('CAPABILITIES.md');
  const diffHasCode = await hasCodeChanges();
  if (diffHasCode && !capabilitiesExists) {
    return false;
  }
  return true;

case 'test_coverage_required':
  // 读取 coverage 报告
  const coverage = await readCoverageReport();
  return coverage.lines >= config.minCoverage;
```

### 完善 PassesGate（P2）

```typescript
// src/gates/passes-gate.ts
export class PassesGate {
  async runTests(): Promise<GateResult> {
    const { stdout } = await execAsync('npm test 2>&1');
    const passed = stdout.includes('passed') && !stdout.includes('failed');
    
    return {
      passed,
      evidence: stdout,
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

## 四、工作量估算

| Phase | 工作量 | 说明 |
|:-----:|:-----:|------|
| **P0** | 10 分钟 | 修复测试 |
| **P1** | 4 小时 | 核心检查逻辑 |
| **P2** | 3 小时 | Gate 实现 |
| **P3** | 6 小时 | 测试覆盖 |
| **总计** | ~13 小时 | 全部优化 |

---

## 五、建议实施顺序

```
Day 1: P0（修复测试）+ P1（核心检查逻辑）
    ↓
Day 2: P2（Gate 实现）
    ↓
Day 3: P3（测试覆盖）
```

---

## 六、长期优化方向

### 1. Agent 集成（Phase 4）

```typescript
// src/monitoring/constraint-doctor.ts
async diagnose(): Promise<DiagnosisResult> {
  // 调用 Agent 进行深度分析
  const agent = await this.agentClient.create({
    model: 'kimi-k2.6',
    prompt: `分析以下约束违规的原因...`,
  });
  
  return agent.execute();
}
```

### 2. 自定义约束（Phase 5）

- 项目级自定义约束（custom-constraints.yml）
- 团队级约束模板
- 约束市场（共享约束）

### 3. 可视化（Phase 6）

- constraint-doctor UI（可视化诊断）
- trace 分析面板
- anomaly 检测图表

---

## 七、与 Studio 集成

### 集成点

| Studio 功能 | harness 集成 |
|------------|------------|
| **Execution.claim** | harness.check() |
| **Meeting.end** | PassesGate.runTests() |
| **PR.create** | ReviewGate.check() |
| **Task.complete** | CheckpointValidator.validate() |

### 实现顺序

1. Studio Execution → harness.check()
2. Studio PR → ReviewGate
3. Studio Meeting → CheckpointValidator

---

## 八、结论

**harness 是 Studio 的地基，但地基不稳：**

- ❌ 核心检查逻辑是空壳（TODO）
- ❌ 测试覆盖率极低（10%）
- ❌ Gate 未完全实现
- ⚠️ 测试失败（constraint 数量）

**优先级**：
1. 修复测试（P0）
2. 实现核心检查逻辑（P1）— **最重要**
3. 完善 Gate（P2）
4. 增加测试覆盖（P3）

**一句话**：harness 的核心价值在于"铁律检查"，但现在检查逻辑是空壳。必须先夯实这个地基。