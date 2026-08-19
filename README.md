# @dommaker/harness

通用 AI Agent 工程约束框架。

约束即知识：运行时检查守住底线，治理回路沉淀经验，一切可追溯。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 为什么需要

Agent 能力强但不可靠。它会跳过测试、声称完成、反复循环、调用危险工具。传统做法是写更长的 Prompt——但 Prompt 只是建议，Agent 可以忽略。

Harness 提供两层核心价值：
1. **运行时约束** — Agent 行动前的代码级检查，不是 Prompt 级建议。check 层约束带真实 checker（diff 扫描、存在性探测、门控校验），fail 即阻断或告警。对未采用对应约定的项目（如无 CAPABILITIES.md），检查诚实报告 `skip`——不阻断、不计入通过率，绝不拿恒过桩凑数
2. **知识沉淀** — 当模型内化了某条规则，人确认后用 `harness constraints retire` 将其退役：规则原文 + 退役原因 + 历史拦截统计一并写入 KnowledgeStore。模型内化了什么，有据可查

---

## 快速开始

```bash
npm install @dommaker/harness
npx @dommaker/harness init --preset standard
npx @dommaker/harness check
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
  JSON.parse(cp.execSync('npx @dommaker/harness constraints --json', { encoding: 'utf-8' }))
);
// { version, hash, counts: { ironLaws, guidelines, prompts }, textSize }
```

> Agent prompt 注入约束由 `@dommaker/studio-shared` 提供（`formatConstraintsForPrompt(role)`）。

---

## 约束体系：check / prompt 二元模型

| 类别 | 数量 | 行为 |
|------|:--:|------|
| **check · Iron Law** | 5 | 代码级检查，违规 throw `ConstraintViolationError` 阻断执行 |
| **check · Guideline** | 4 | 代码级检查，违规记录 warning 放行 |
| **prompt** | 16 | 纯文本行为约束，注入 Agent context，不占检查位、不产生 trace 统计 |

- check 层每条必须带真实 checker（注册表闭环，引用未注册 checker 构建报错）；`capability_sync`/`docs_freshness`/`context_doc_sync` 为存在性探测——项目未采用对应约定文件时 skip（不阻断、不计 pass/fail）。
- prompt 层带角色路由与适用性标签；场景专属条目仅在 config.yml `scenes` 命中时进入生效集。
- 生效集由 `getEffectiveConstraints(projectRoot)` 统一计算：内置 → preset 裁剪 → config.yml 禁用 → custom 追加 → scenes 过滤。init 注入、`harness check`、外部消费者全部走它。

约束定义按类别维护在数据文件中（`src/core/constraints/definitions/{iron-laws,guidelines,prompts}.ts`），检查逻辑在 `checkers/` 目录按规则独立实现。完整约束列表见 [CAPABILITIES.md](CAPABILITIES.md)。

---

## 约束治理回路

约束是知识，不是教条。约束的进化发生在外环——数据不出门，人确认每一步：

```
report 观测 → retire（人确认）→ 知识沉淀 → --export 回传 → 维护者发版演进内置集
```

- `harness constraints report` — 只读观测：check 层统计、四类退役候选诊断（零触发/零拦截/不可评估/高噪）、配置健康、注入漂移；`--export` 输出脱敏 markdown 摘要，供使用方回传给维护者。
- `harness constraints retire` — 交互选择退役候选，**执行前保留一次人确认**。带 id 直达（`harness constraints retire <id> --yes`）也须显式 `--yes` 确认，无 `--yes` 报错不执行。落盘为 config.yml `enabled: false` + `retired` 元数据，同时写入 **KnowledgeStore**（规则原文 + 退役原因 + 历史统计），并自动同步 CLAUDE.md 注入段。退役不是删除——删除 config.yml 中对应段即可回滚。
- 维护者收到回传摘要后编辑内置 definitions 并发版，内置集由此演进。不使用遥测，不做自动降级。

---

## CLI

```bash
# 核心
harness check          # 约束检查（pre-commit hook 用）
harness validate       # 检查点验证（失败退出码 1，可用于 CI 门控）
harness init           # 初始化 .harness/ 目录（不覆盖已有运行时配置）
harness status         # 项目健康状态、统计、异常检测
harness constraints    # 约束元数据（版本/hash/计数/文本大小）
harness constraints report   # 约束使用报告：统计 + 退役候选诊断 + 配置健康 + 注入漂移（--export 脱敏）
harness constraints retire   # 约束退役：交互选择 + 人确认 → config.yml + KnowledgeStore + 注入段同步
harness constraints retire <id> --yes   # 直达退役：显式 --yes 人确认（无 --yes 拒绝执行）
harness report         # 生成检查报告

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
preset: standard  # strict | standard | relaxed（relaxed 仅启用 5 条 check 约束）
scenes: []        # 场景标签，命中场景专属 prompt 才进入生效集
```

`preset` 真实影响运行时检查与注入；`constraints.<id>.enabled: false` 可单独禁用。

---

## 核心能力

| 模块 | 说明 |
|------|------|
| 约束引擎 | check/prompt 二元约束 + 生效集合并（`getEffectiveConstraints`）+ 注入渲染/漂移校验 |
| 知识引擎 | 约束退役 → KnowledgeStore 沉淀（规则原文 + 原因 + 历史统计），可检索、可追溯 |
| 门禁系统 | 8 种门禁：测试/验收/性能/安全/契约/审查/命令/检查点 |
| Hook 管线 | 通用 before/after/around hook：注册 → 排序 → 错误隔离 → 采样执行 |
| 上下文/监控 | Token 预算 + 会话压缩 + Trace 收集/分析 |

### 代码结构

```
src/
├── core/constraints/       # 约束定义（definitions/{iron-laws,guidelines,prompts}）+ checkers/ + 注入渲染/漂移校验 + 使用统计
├── core/effective-constraints.ts  # 生效集唯一来源（内置→preset→config→custom→scenes）
├── core/validators/        # 检查点校验器（check-handlers/）
├── cli/                    # CLI 命令实现（sync-docs/ 模块族等）
├── knowledge/              # 知识引擎（存储/检索/衰减/诊断）
├── gates/                  # 各类门禁实现
└── monitoring/             # Trace 收集/分析与上下文追踪
```

各目录的 `CONTEXT.md` 是权威模块文档。变更历史见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT
