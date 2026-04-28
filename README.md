# @dommaker/harness

> AI Agent 的工程约束框架 — 让 Agent 不会乱承诺、不会跳过验证、不会简化测试。

---

## 🚀 快速开始

### 安装

```bash
npm install -g @dommaker/harness
```

### 最小工作流

```bash
# 开发前
harness check

# 开发 + 写测试

# 提交前
harness passes-gate
```

---

## 📋 CLI 命令

### 日常使用

```bash
harness check           # 检查铁律（开发前后必用）
harness passes-gate     # 测试门控（提交前验证）
harness status          # 查看状态（异常、统计）
```

### 项目初始化

```bash
harness init --preset standard    # 初始化配置
harness init --print-snippets     # 输出代码片段
```

### Spec 验证

```bash
harness spec            # 验证所有 Spec
harness spec --staged   # 验证暂存文件
harness spec list       # 支持的 Spec 类型
```

### 诊断

```bash
harness diagnose run --hours 24 --save   # 运行诊断
harness diagnose list                      # 查看诊断结果
harness propose generate --save            # 生成建议
harness propose review --accept            # 接受建议
```

---

## 🎯 核心概念

### 三层约束体系

| 层级 | 严重性 | 说明 |
|------|:------:|------|
| **Iron Law** | 🔴 error | 绝对禁止，无例外 |
| **Guideline** | 🟡 warning | 推荐遵守，有例外 |
| **Tip** | 🔵 info | 信息性提示 |

### 7 条铁律

| ID | 规则 |
|---|------|
| `no_bypass_checkpoint` | 禁止跳过检查点 |
| `no_self_approval` | 禁止自评通过（必须测试）|
| `no_completion_without_verification` | 完成必须验证 |
| `no_test_simplification` | 禁止简化测试 |
| `incremental_progress` | 单任务单会话 |
| `verify_external_capability` | 外部能力先验证 |
| `no_implementation_without_requirement_review` | 实现后对比需求 |

### 7 种门禁

| 门禁 | 用途 |
|------|------|
| PassesGate | 测试门控 |
| ReviewGate | PR 审核检查 |
| SecurityGate | 安全检查（npm audit）|
| PerformanceGate | 性能门控 |
| ContractGate | API 契约验证 |
| CheckpointValidator | 检查点验证 |
| SpecAcceptanceGate | 验收标准检查 |

---

## 🔧 代码集成

```typescript
import {
  IronLawChecker,
  PassesGate,
  CheckpointValidator,
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

---

## 📁 项目配置

### .harness/config.yml

```yaml
preset: standard

# 自定义约束例外
custom_constraints:
  no_fix_without_root_cause:
    extend_exceptions:
      - my_special_case
```

### CI 集成

```yaml
# .github/workflows/harness-check.yml
jobs:
  harness-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: harness check
      - run: harness passes-gate
```

---

## 📊 Trace & 日志

```
.harness/
├── traces/
│   ├── execution.log      # 约束检查记录
│   └── summary.json       # 统计汇总
└── logs/
    ├── performance.log    # 性能日志
    └── tokens.log         # Token 使用
```

### 错误分级

| 等级 | 处理 |
|------|------|
| L1 | 自动重试 |
| L2 | 人工审核 |
| L3 | 开会讨论 |
| L4 | 回滚 |

---

## 🔧 开发

```bash
npm install
npm run build
npm test
```

---

## 📝 License

MIT © dommaker
