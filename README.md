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
harness flow            # 一键诊断 + 提案流程
```

### 项目初始化

```bash
harness init --preset standard    # 初始化配置
harness init --print-snippets     # 输出代码片段
```

### 门禁检查

```bash
# 测试门控
harness passes-gate                    # 运行测试
harness passes-gate --coverage         # 检查覆盖率
harness pg                              # 别名

# 验收标准
harness acceptance --task-id TASK-001  # 检查指定任务
harness acceptance --check-all         # 检查所有任务
harness acceptance list                 # 列出验收标准
harness acc                             # 别名

# 性能门控
harness performance --coverage --coverage-threshold 85  # 覆盖率检查
harness performance --bundle --bundle-threshold 300      # 打包大小检查
harness perf                                              # 别名

# 安全门控
harness security                        # npm audit 检查
harness security --severity critical    # 只显示 critical 级别
harness security audit                  # 详细漏洞报告
harness sec                             # 别名

# API 契约
harness contract                        # OpenAPI Schema 验证
harness contract validate               # Schema 语法验证
harness contract --contract-path api/openapi.yaml

# 代码审查
harness review                          # PR 审查状态检查
harness review --min-reviewers 2        # 要求 2 个审批
harness review status                   # PR 详情
```

### Spec 验证

```bash
harness spec            # 验证所有 Spec
harness spec --staged   # 验证暂存文件
harness spec list       # 支持的 Spec 类型
```

### 检查点验证

```bash
harness validate                     # 验证检查点
harness validate --strict            # 严格模式
harness validate -f checkpoint.json  # 指定文件
```

### 报告

```bash
harness report                        # 生成 Markdown 报告
harness report -f json                # JSON 格式
harness report -o report.md           # 输出到文件
```

### 诊断（已弃用，请用 flow）

```bash
harness flow                          # 一键诊断 + 提案
harness flow --auto-apply             # 自动应用低风险提案
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

### 7 种门禁（均有 CLI 命令）

| 门禁 | CLI 命令 | 用途 |
|------|:--------:|------|
| PassesGate | `passes-gate` / `pg` | 测试门控 |
| SpecAcceptanceGate | `acceptance` / `acc` | 验收标准检查 |
| PerformanceGate | `performance` / `perf` | 性能门控 |
| SecurityGate | `security` / `sec` | 安全检查 |
| ContractGate | `contract` | API 契约验证 |
| ReviewGate | `review` | PR 审核检查 |
| CheckpointValidator | `validate` | 检查点验证 |
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
