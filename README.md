# @dommaker/harness

通用 AI Agent 工程约束框架。

让 AI Agent 在边界内稳定工作：铁律不可破，指南可演化，一切可追溯。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 为什么需要

Agent 能力强但不可靠。它会跳过测试、声称完成、反复循环、调用危险工具。传统做法是写更长的 Prompt——但 Prompt 只是建议，Agent 可以忽略。

Harness 是 Agent 的"操作系统"——它在 Agent 行动前做检查，在 Agent 完成后做验证，在约束过时时自动退化。它是代码级约束，不是 Prompt 级建议。

---

## 快速开始

```bash
npm install @dommaker/harness
npx harness init --preset standard
npx harness check
```

**作为库使用**：

```typescript
import { checkBeforeExecution, buildConstraintPrompt } from '@dommaker/harness';

// Agent 启动前检查
await checkBeforeExecution({
  operation: 'code_implementation',
  taskDescription: '重构用户认证模块',
  projectPath: '/path/to/project',
  hasWorktree: true,
});

// Agent prompt 注入约束
const constraints = buildConstraintPrompt({
  operation: 'code_implementation',
  taskDescription: '重构用户认证模块',
});
```

---

## 三层约束体系

| 层级 | 严重性 | 数量 | 行为 |
|------|:--:|:--:|------|
| **Iron Law** | error | 13 | 违反抛 `ConstraintViolationError`，阻断执行 |
| **Guideline** | warning | 13 | 记录警告，`injectPrompt` 注入 Agent context |
| **Tip** | info | 2 | 信息性提示 |

完整约束列表见 [CAPABILITIES.md](CAPABILITIES.md)。

---

## 约束生命周期

约束不是永久的。quality 层根据拦截率自动演化：

```
active → 拦截率低于阈值 → degrade → deprecated
                                ← rollback
```

- Iron Law 永久，不退化
- Guideline：最近 ≥10 次检查中拦截率 < 30% → 降为 tip
- 降级后可手动回滚恢复原级别
- 退化基于拦截率，不基于日历时间（项目暂停不会触发退化）

---

## CLI

```bash
harness check        # 约束检查（pre-commit hook 用）
harness init         # 初始化 .harness/ 目录
harness sync-docs    # 同步 CAPABILITIES.md
harness status       # 项目健康状态
harness validate     # 检查点验证
harness report       # 报告生成
```

完整 CLI 见 [CAPABILITIES.md](CAPABILITIES.md)。

---

## 配置

```yaml
# .harness/config.yml
preset: standard  # strict | standard | relaxed
```

---

## 核心能力

| 模块 | 说明 |
|------|------|
| 约束引擎 | 三层约束 + 生命周期（自动退化/回滚） |
| 知识引擎 | KnowledgeStore/Query/Ingest — 存储、检索、演化 |
| 门禁系统 | 8 种门禁：测试/验收/性能/安全/契约/审查/命令/检查点 |
| 安全护栏 | Input/Output/Tool Guardrail + Sandbox (L1-L4) |
| Hook 系统 | 10 个生命周期 hook |
| 上下文/监控 | Token 预算 + 会话压缩 + Trace 诊断 + 约束进化 |

变更历史见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT
