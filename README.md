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
import { checkBeforeExecution, getAllConstraints } from '@dommaker/harness';

// Agent 启动前检查
await checkBeforeExecution({
  operation: 'code_implementation',
  taskDescription: '重构用户认证模块',
  projectPath: '/path/to/project',
  hasWorktree: true,
});

// 获取约束元数据
const meta = await import('child_process').then(cp =>
  JSON.parse(cp.execSync('npx harness constraints --json', { encoding: 'utf-8' }))
);
// { version, hash, counts: { ironLaws, guidelines, tips }, textSize }
```

> Agent prompt 注入约束由 `@dommaker/studio-shared` 提供（`formatConstraintsForPrompt(role)`）。

---

## 三层约束体系

| 层级 | 严重性 | 数量 | 行为 |
|------|:--:|:--:|------|
| **Iron Law** | error | 12 | 阻断执行。拦截率 <5% 时自动降为 guideline |
| **Guideline** | warning | 28 | 注入 Agent context。拦截率 <30% 时降为 tip |
| **Tip** | info | 2 | 信息性提示。拦截率 <10% 时标记废弃 |

约束定义按层级维护在数据文件中（`src/core/constraints/definitions/{iron-laws,guidelines,tips}.ts`），检查逻辑在 `checkers/` 目录按规则独立实现。完整约束列表见 [CAPABILITIES.md](CAPABILITIES.md)。

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
# 核心
harness check          # 约束检查（pre-commit hook 用）
harness validate       # 检查点验证（失败退出码 1，可用于 CI 门控）
harness init           # 初始化 .harness/ 目录（不覆盖已有运行时配置）
harness status         # 项目健康状态、统计、异常检测
harness constraints    # 约束元数据（版本/hash/计数/文本大小）
harness report         # 生成检查报告
harness flow           # 一键执行诊断 + 提案流程

# 门禁
harness passes-gate    # 测试门控（别名 pg）
harness acceptance     # 验收标准门控
harness performance    # 性能门控
harness security       # 安全门控
harness contract       # API 契约门控（OpenAPI Schema）
harness review         # 代码审查门控
harness command        # 命令黑名单检查

# 知识与演化
harness knowledge      # 知识库管理（list/search/import/decay/stats/audit）
harness failure        # 失败记录管理（list/stats/clear）
harness analyze-sessions  # 挖掘会话中的纠正模式，生成规则候选
harness update-user-model # 增量更新用户思维模型

# 文档与 Spec
harness sync-docs      # 同步 CAPABILITIES.md + CONTEXT.md + AGENTS.md
harness doc-freshness-check  # 文档声明新鲜度检查
harness spec           # Spec 验证
harness spec-baseline-check  # Spec 前置条件验证
harness sdd            # SDD 索引管理

# 发布
harness release        # npm 发布流水线（tsc → dist 验证 → version → push → publish → gh release）
```

完整参数见各命令 `--help`，能力清单见 [CAPABILITIES.md](CAPABILITIES.md)。

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
| Hook 管线 | 通用 before/after/around hook：注册 → 排序 → 错误隔离 → 采样执行 |
| 上下文/监控 | Token 预算 + 会话压缩 + Trace 诊断 + 约束进化 |

### 代码结构

```
src/
├── core/constraints/       # 约束定义（iron-laws/guidelines/tips）+ checkers/
├── core/validators/        # 检查点校验器（check-handlers/）
├── cli/                    # CLI 命令实现（sync-docs/ 模块族等）
├── constraints/            # ConstraintRegistry + 生命周期执行器
├── knowledge/              # 知识引擎（存储/检索/衰减/诊断）
├── gates/                  # 各类门禁实现
├── safety/                 # 护栏与沙箱
├── evolution/              # 约束自动演化
└── monitoring/             # Trace 分析与诊断（规则数据化）
```

各目录的 `CONTEXT.md` 是权威模块文档。变更历史见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT
