# src

> harness 核心源码目录。约束引擎、门禁系统、知识引擎、上下文管理、安全护栏等全部子系统在此实现。

## 职责

- 约束定义与检查（Iron Laws / Guidelines / Tips 三层体系）
- 门禁系统（验收/性能/安全/契约/审查/命令黑名单）
- 知识引擎（存储/查询/引用/质量/生命周期）
- 上下文管理（Token 预算/会话压缩/渐进加载）
- 安全护栏（输入/输出/工具/沙箱）
- 监控与诊断（Trace 收集/性能分析/约束演化）
- 验证循环/Spec 检查/架构约束/AI 治理

## 核心导出

`src/index.ts` 通过 barrel export 导出所有公共 API：
- `checkConstraints()` / `checkBeforeExecution()` — 约束检查入口
- `ConstraintChecker` — 检查引擎
- `ProjectConfigLoader` — 项目配置加载
- `TraceCollector` / `TraceAnalyzer` — 监控系统
- `KnowledgeStore` / `KnowledgeQuery` — 知识引擎
- `InputGuardrail` / `OutputGuardrail` / `Sandbox` — 安全护栏
- `ConstraintRegistry` / `ConstraintLifecycleRunner` — 约束生命周期
- 全部类型（types/）

## 依赖关系

- 零外部运行时依赖（纯 TypeScript + Node.js 标准库）
- `yaml` 用于解析配置文件
- `commander` 用于 CLI
- 被 `@dommaker/studio-shared` 和其他 consumer 依赖

## 注意事项

- **零 Token 成本（默认）**：核心检查纯文件 I/O，不调用 LLM
- **无业务逻辑**：约束规则通用，领域概念由 consumer 管理
- **追加写入**：trace/failure 日志为单行 JSON，自动滚动
- **类型安全**：主要类型在 `types/` 目录，接口变更是 breaking change
