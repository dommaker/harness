# @dommaker/harness

> AI Agent 的工程约束框架 — 铁律系统、门禁系统、质量检查

## 一句话

**harness 让 Agent 不会乱承诺、不会跳过验证、不会简化测试。**

---

## 快速上手

### CLI 命令速查

```bash
# 安装
npm install @dommaker/harness

# 初始化项目
harness init --preset standard

# 检查铁律（开发前后必用）
harness check

# 查看状态（异常、统计）
harness status

# 验证检查点
harness validate

# 测试门控
harness passes-gate

# Spec 验证
harness spec

# 一键诊断
harness flow
```

### 最小工作流

```
开始开发
    ↓
harness check (检查铁律)
    ↓
写代码 + 写测试
    ↓
harness passes-gate (验证通过)
    ↓
提交
```

---

## Agent 工作流程

### 1. Session 启动检查

Agent 开始工作前，自动检查：

| 检查项 | 说明 |
|--------|------|
| 工作目录干净？ | 无未提交变更 |
| Roadmap 存在？ | 知道要做什么 |
| Spec 存在？ | 知道怎么做 |
| 依赖满足？ | 前置任务完成 |

```bash
harness status
```

### 2. 开发中铁律检查

**Iron Laws（绝对禁止）**：

| ID | 规则 | Agent 不能做 |
|---|------|-------------|
| `no_bypass_checkpoint` | 禁止跳过检查点 | ❌ "先跳过验证" |
| `no_self_approval` | 禁止自评通过 | ❌ "应该没问题" |
| `no_completion_without_verification` | 完成必须有验证 | ❌ "任务完成了"（未测试）|
| `no_test_simplification` | 禁止简化测试 | ❌ "测试太难，先删掉" |

```bash
harness check
```

### 3. 完成前验证

Agent 声明完成前，必须通过门禁：

| 门禁 | 检查内容 |
|------|---------|
| PassesGate | 测试必须通过 |
| ReviewGate | PR 必须有人审核 |
| SecurityGate | 无高危漏洞 |
| PerformanceGate | 性能达标 |

```bash
harness passes-gate
```

### 4. Spec 验证

验证架构文档、API 定义等 Spec 文件：

```bash
harness spec              # 验证所有 Spec
harness spec --staged     # 验证暂存文件
harness spec list         # 支持的 Spec 类型
```

---

## 核心概念

### 三层约束体系

| 层级 | 名称 | 严重性 | 举例 |
|------|------|:------:|------|
| **Iron Law** | 铁律 | 🔴 error | 禁止跳过检查点 |
| **Guideline** | 指导 | 🟡 warning | 写代码前写测试 |
| **Tip** | 提示 | 🔵 info | 新模块要有 README |

### 16 条内置约束

**Iron Laws（4 条）**：

| ID | 规则 |
|---|------|
| `no_bypass_checkpoint` | 禁止跳过检查点 |
| `no_self_approval` | 禁止自评通过 |
| `no_completion_without_verification` | 完成必须验证 |
| `no_test_simplification` | 禁止简化测试 |

**Guidelines（10 条）**：

| ID | 规则 |
|---|------|
| `no_fix_without_root_cause` | 修复前找根因 |
| `no_code_without_test` | 先写测试 |
| `no_any_type` | 禁止 any |
| `simplest_solution_first` | 最简方案优先 |
| `no_creation_without_reuse_check` | 创建前检查复用 |
| `capability_sync` | 代码变更更新 CAPABILITIES |
| `no_simplification_without_approval` | 禁止擅自简化 |
| `no_skill_without_test` | 技能要有测试 |
| `test_coverage_required` | 覆盖率达标 |
| `design_decision_requires_discussion` | 设计决策先讨论 |

**Tips（2 条）**：

| ID | 规则 |
|---|------|
| `readme_required` | 新模块有 README |
| `doc_required_for_public_api` | 公共 API 有文档 |

---

## 7 种门禁

| 门禁 | 类 | 用途 |
|------|-----|------|
| PassesGate | 测试门控 | 禁止自评通过 |
| ReviewGate | 审查门控 | PR 审核检查 |
| SecurityGate | 安全门控 | npm audit |
| PerformanceGate | 性能门控 | 响应时间、覆盖率 |
| ContractGate | 契约门控 | OpenAPI 验证 |
| CheckpointValidator | 检查点验证 | 步骤结果验证 |
| SpecAcceptanceGate | 验收门控 | 验收标准检查 |

---

## 预设系统

| 预设 | 说明 |
|------|------|
| `strict` | 所有检查启用 |
| `standard` | 推荐使用 |
| `relaxed` | 警告不阻止 |

```bash
harness init --preset standard
```

---

## 高级功能

### CLI 详细命令

```bash
# 初始化（输出代码片段）
harness init --print-snippets

# 铁律检查
harness check --list      # 列出所有铁律
harness check --json      # JSON 输出

# 状态查看
harness status --detail   # 详细状态
harness status --anomalies # 只显示异常

# Trace 分析（已弃用，用 status）
harness traces stats      # 统计
harness traces anomalies  # 异常检测

# 诊断流程
harness diagnose run --hours 24 --save
harness diagnose list
harness propose generate --save
harness propose review --diagnosis <id> --accept
```

### 项目自定义约束

```yaml
# .harness/custom-constraints.yml
custom_constraints:
  no_fix_without_root_cause:
    # 追加例外（保留内置）
    extend_exceptions:
      - my_special_case
    # 或完全覆盖
    exceptions:
      - my_only_exception
```

### 在代码中使用

```typescript
import {
  IronLawChecker,
  PassesGate,
  CheckpointValidator,
  SessionStartup,
  interceptOperation,
} from '@dommaker/harness';

// 铁律检查
const checker = IronLawChecker.getInstance();
const results = await checker.checkAll(context);

// 测试门控
const gate = new PassesGate({ requireEvidence: true });
const passed = await gate.runTests();

// 检查点验证
const validator = CheckpointValidator.getInstance();
const result = await validator.validate(checkpoints, context);

// 拦截器（自动执行 enforcement）
await interceptOperation('task_completion_claim', context);
```

### 拦截器 Enforcement IDs

| enforcement | 说明 |
|-------------|------|
| `verify-completion` | 验证完成：运行测试 |
| `verify-e2e` | E2E 测试验证 |
| `debug-systematic` | 系统性调试 |
| `reuse-first` | 复用优先检查 |
| `update-capabilities` | CAPABILITIES 同步 |
| `tdd-cycle` | TDD 循环检查 |
| `passes-gate` | 测试门控 |
| `checkpoint-required` | 检查点必须通过 |

---

## CI 配置

```yaml
# .github/workflows/harness-check.yml
jobs:
  harness-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx harness check
      - run: npx harness passes-gate
```

---

## Trace 系统

### Execution Trace

记录约束检查结果，用于：
- 统计触发频率
- 检测异常（高绕过率、失败上升）

```
.harness/traces/
├── execution.log      # 当前 trace
├── summary.json       # 统计汇总
```

### Performance Trace

记录操作耗时，用于：
- 监控慢操作
- 检测超阈值

```
.harness/logs/
├── performance.log    # 性能日志
├── tokens.log         # Token 使用
```

### Failure Classification

错误分级（L1-L4）：

| 等级 | 处理 |
|------|------|
| L1 | 自动重试 |
| L2 | 人工审核 |
| L3 | 开会讨论 |
| L4 | 回滚 |

---

## 开发

```bash
npm install
npm run build
npm test
```

---

## 许可证

MIT © dommaker