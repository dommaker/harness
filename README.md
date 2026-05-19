# @dommaker/harness

通用 AI Agent 工程约束框架 — 铁律系统 + 知识引擎 + 安全护栏

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 安装

```bash
npm install @dommaker/harness
```

### CLI

```bash
harness check                    # 约束检查
harness init --preset standard   # 初始化 .harness/
harness status                   # 状态查看
harness report                   # 报告生成
harness validate                 # 检查点验证
harness sync-docs                # 文档新鲜度同步
```

### 作为库使用

```typescript
import {
  checkConstraints,
  checkBeforeExecution,
  buildConstraintPrompt,
  ConstraintChecker,
  ConstraintInterceptor,
  KnowledgeStore,
  KnowledgeIngest,
  KnowledgeQuery,
  TraceCollector,
} from '@dommaker/harness';

// 约束检查
const result = await checkConstraints({ operation: 'code_implementation', taskDescription: 'add login page' });

// Agent prompt 注入
const prompt = buildConstraintPrompt({ operation: 'code_implementation', taskDescription: 'add login page' });
```

---

## 三层约束体系

| 层级 | 严重性 | 数量 | 说明 |
|------|:--:|:--:|------|
| **Iron Law** | error | 12 | 绝对禁止，触发抛 `ConstraintViolationError` |
| **Guideline** | warning | 14 | 推荐遵守，`injectPrompt: true` 注入 Agent context |
| **Tip** | info | 2 | 信息性提示 |

新增 (2026-05-19): `first_principles_first` — 第一性优先分析方法论

---

## 子系统

| 模块 | 说明 |
|------|------|
| 约束引擎 | 三层约束检查 + 拦截器 + 自定义约束 |
| 知识引擎 | KnowledgeStore/Query/Ingest/Linter + 生命周期 |
| 门禁系统 | 8 种门禁: 测试/验收/性能/安全/契约/审查/命令/检查点 |
| 上下文管理 | Token 预算 + 会话压缩 + 知识注入 |
| 安全护栏 | Input/Output/Tool Guardrail + Sandbox (L1-L4) |
| 监控 | Trace 收集/诊断/约束进化 |
| 架构约束 | 跨项目依赖检查 + API 同步 |
| 失败处理 | 错误分类 + 失败记录 |

---

## 配置

### .harness/config.yml

```yaml
preset: standard  # strict | standard | relaxed
```

### Presets

| Preset | 说明 |
|--------|------|
| `strict` | 全部约束启用 |
| `standard` | Iron Laws + Guidelines（默认） |
| `relaxed` | 仅 Iron Laws |

---

## 开发

```bash
npm install
npm run build
npm test
```

## 许可证

MIT
