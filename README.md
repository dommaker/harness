# @dommaker/harness

> AI Agent 工程约束框架 — 从代码质量约束到知识积累引擎

[![npm version](https://img.shields.io/npm/v/@dommaker/harness)](https://www.npmjs.com/package/@dommaker/harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 定位

```
代码质量约束（补偿模型弱点）
        ↓
知识积累基础设施（模型做不到的事）
+ 最小安全护栏（模型无关的底线）
```

**核心理念：Harness 不是目的，知识才是护城河。**

Skill、Agent、工具链会随模型迭代更新，但领域知识是永恒的。

---

## 安装

```bash
npm install @dommaker/harness
```

### CLI

```bash
harness check                # 检查约束（开发前后）
harness passes-gate          # 测试门控（提交前）
harness status               # 查看状态和异常
harness flow                 # 一键诊断 + 优化提案
harness init --preset standard  # 初始化配置
```

### 作为库使用

```typescript
import {
  // 约束系统
  checkConstraints,
  checkBeforeExecution,
  interceptOperation,
  // 知识引擎
  KnowledgeService,
  // 安全护栏
  SafetyService,
  // 上下文管理
  ContextService,
  // Agent 生命周期
  AgentService,
} from '@dommaker/harness';

// 约束检查
const result = await checkConstraints(context);
if (!result.passed) {
  console.error(result.ironLaws.filter(r => !r.passed));
}

// 知识查询
const knowledge = KnowledgeService.getInstance();
const docs = await knowledge.getQuery().search('architecture decisions');

// 安全护栏
const safety = SafetyService.getInstance();
const guardrail = safety.getInputGuardrail();
await guardrail.check(userInput);

// Token 预算
const ctx = ContextService.getInstance();
const budget = ctx.getBudget();
budget.allocate('system', 2000);
budget.allocate('user', 4000);
```

---

## 核心架构

### 三层约束体系

| 层级 | 严重性 | 说明 |
|------|:------:|------|
| **Iron Law** | error | 绝对禁止，无例外（7 条） |
| **Guideline** | warning | 推荐遵守，有例外（9 条） |
| **Tip** | info | 信息性提示（2 条） |

### 子系统

| 模块 | 目录 | 说明 |
|------|------|------|
| **约束引擎** | `core/`, `constraints/` | 三层约束检查、拦截器、自定义约束配置 |
| **知识引擎** | `knowledge/` | 存储、查询、引用追踪、质量检查、生命周期（draft→canonical→archived） |
| **上下文管理** | `context/` | Token 预算、会话压缩、渐进式加载、知识注入 |
| **安全护栏** | `safety/` | 输入/输出/工具调用安全检查、沙箱（L1-L4） |
| **验证循环** | `verification/` | 规则引擎 + 推理验证，支持检查点恢复 |
| **门禁系统** | `gates/` | 8 种门禁：测试/验收/性能/安全/契约/审查/命令/检查点 |
| **监控** | `monitoring/` | Trace 收集分析、约束诊断/进化、知识诊断/进化 |
| **Agent 管理** | `agents/` | Agent 生命周期状态机（init→running→completed） |
| **LLM 集成** | `llm/` | LLM 适配层，支持多 provider |
| **失败处理** | `failure/` | 错误分类、失败记录 |
| **Dashboard** | `dashboard/` | 统计面板、状态展示 |
| **架构约束** | `architecture/` | 架构级约束检查、跨项目依赖检查 |
| **Spec 检查** | `spec/` | 代码注解中的 Spec 验证 |

---

## CLI 命令

### 日常

```bash
harness check                    # 约束检查
harness passes-gate [options]    # 测试门控（别名: pg）
harness status [--anomalies]     # 状态查看
harness flow [--auto-apply]      # 诊断 + 提案
```

### 门禁

```bash
harness acceptance [--task-id ID] [--check-all]  # 验收标准（别名: acc）
harness performance [--coverage] [--bundle]       # 性能门控（别名: perf）
harness security [--severity level]               # 安全检查（别名: sec）
harness contract [--contract-path path]           # API 契约验证
harness review [--min-reviewers N]                # PR 审查检查
harness command "command string"                  # 命令黑名单（别名: cmd）
```

### 其他

```bash
harness init [--preset standard|strict|relaxed]  # 初始化
harness validate [--strict]                       # 检查点验证
harness spec [--staged]                           # Spec 验证
harness report [-f json|markdown] [-o file]       # 报告生成
```

---

## 配置

### .harness/config.yml

```yaml
preset: standard  # standard | strict | relaxed

# 自定义约束例外
custom_constraints:
  no_fix_without_root_cause:
    extend_exceptions:
      - hotfix_branch
```

### Presets

| Preset | 说明 |
|--------|------|
| `strict` | 全部约束启用（Iron Laws + Guidelines + Tips） |
| `standard` | Iron Laws + Guidelines（默认） |
| `relaxed` | 仅 Iron Laws |

---

## CI 集成

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

## 日志与诊断

运行时状态存储在 `.harness/` 目录：

```
.harness/
├── traces/           # 约束检查记录（JSON Lines）
├── failures/         # 失败记录
└── state.json        # 运行状态
```

```bash
harness status --anomalies    # 查看异常
harness status --hours 48     # 最近 48 小时统计
harness flow --auto-apply     # 诊断 + 自动应用低风险提案
```

---

## 开发

```bash
npm install
npm run build          # 编译 TypeScript
npm test               # 运行测试（覆盖率阈值 50%）
npm run lint           # ESLint
```

## 许可证

MIT
