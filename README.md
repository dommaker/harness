# @dommaker/harness

通用 AI Agent 工程约束框架。

约束即知识，随模型进化而沉淀。铁律可退化，指南可演化，一切可追溯。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 为什么需要

Agent 能力强但不可靠。它会跳过测试、声称完成、反复循环、调用危险工具。传统做法是写更长的 Prompt——但 Prompt 只是建议，Agent 可以忽略。

Harness 提供两层核心价值：
1. **运行时约束** — Agent 行动前的代码级检查，不是 Prompt 级建议
2. **知识沉淀** — 当模型内化了某条规则，约束自动降级为知识记录（KnowledgeStore），保留"这个规则曾经保护过什么"

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
| **Iron Law** | error | 13 | 阻断执行。拦截率 <5% 时自动降为 guideline |
| **Guideline** | warning | 13 | 注入 Agent context。拦截率 <30% 时降为 tip |
| **Tip** | info | 2 | 信息性提示。拦截率 <10% 时标记废弃 |

完整约束列表见 [CAPABILITIES.md](CAPABILITIES.md)。

---

## 约束生命周期

约束是知识，不是教条。随着模型能力提升，约束会自动降级为知识沉淀：

```
active → 拦截率低于阈值 → degrade → deprecated → 写入 KnowledgeStore
                                ← rollback (可回滚)
```

| 层级 | 退化阈值 | 退化目标 |
|------|---------|---------|
| Iron Law | 拦截率 < 5%（≥100 次检查） | → guideline |
| Guideline | 拦截率 < 30%（≥10 次检查） | → tip |
| Tip | 拦截率 < 10%（≥10 次检查） | → info → deprecated |

- 退化基于拦截率，不基于日历时间。可手动回滚恢复原级别。
- 降级时写入 **KnowledgeStore**（知识引擎的存储层）——保留规则原文 + 退化原因 + 历史拦截数据。模型内化了什么，有据可查。

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
| 知识引擎 | 约束退化 → KnowledgeStore 沉淀，可检索、可追溯 |
| 门禁系统 | 8 种门禁：测试/验收/性能/安全/契约/审查/命令/检查点 |
| 安全护栏 | Input/Output/Tool Guardrail + Sandbox (L1-L4) |
| Hook 系统 | 10 个生命周期 hook |
| 上下文/监控 | Token 预算 + 会话压缩 + Trace 诊断 + 约束进化 |

变更历史见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT
