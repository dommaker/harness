# src/ — Harness Framework Core

## 职责
通用工程约束框架的 TypeScript 核心代码。定义约束系统、检查点验证、质量门控、知识基础设施。

## 核心导出 (dist/)
- `index.ts`: 全量导出
- `core/index.ts`: 核心约束引擎
- `presets/index.ts`: 预设配置
- `context/index.ts`: 上下文管理

## 目录
| 目录 | 职责 |
|------|------|
| core/ | 约束引擎、检查点验证器、会话管理 |
| gates/ | 质量门 (acceptance, command, contract, performance, review, security) |
| monitoring/ | 追踪收集/分析、性能、诊断 |
| failure/ | 错误分类、失败记录 |
| context/ | 渐进式上下文加载、token 预算管理 |
| architecture/ | 架构约束、跨项目检查 |
| spec/ | Spec 注解验证 |
| cli/commands/ | 17 个 CLI 子命令 |
| tools/ | 工具定义 |
| safety/ | 沙箱、护栏 |

## 依赖关系
- `src/core/` 被所有模块依赖（基础层）
- `src/gates/` 依赖 `src/core/` 类型
- `src/cli/` 依赖所有模块

## 注意事项
- 公共包，禁止硬编码业务路径
- 约束定义在 `core/constraints/definitions.ts`，不应在运行时代码中定义
- `bin/` 只有 CLI 入口发布到 npm
