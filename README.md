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

约束不是永久的。quality 层支持自动退化：

```
active → intercept 率低于阈值 → scheduled → degrade → deprecated
                                                      ← rollback
```

- Iron Law 永久，不退化
- Guideline 拦截率 < 30% → 自动降为 tip
- 连续 30 天 0 拦截 → 标记废弃
- 退化后可手动回滚

---

## CLI

```bash
harness check        # 约束检查（pre-commit hook 用）
harness init         # 初始化项目 .harness/ 目录
harness sync-docs    # 同步 CAPABILITIES.md
harness validate     # 检查点验证
harness status       # 项目状态
harness report       # 报告生成
```

---

## 配置

```yaml
# .harness/config.yml
preset: standard  # strict | standard | relaxed
```

---

## 文档

| 文档 | 内容 |
|------|------|
| [CAPABILITIES.md](CAPABILITIES.md) | 完整功能清单（模块、文件、约束） |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更历史 |
| [CLAUDE.md](CLAUDE.md) | 开发指南 |

## 许可证

MIT
