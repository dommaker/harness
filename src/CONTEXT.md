# src/ — Harness Framework Core

## 职责
通用工程约束框架的 TypeScript 核心代码。定义约束系统、检查点验证、质量门控、知识基础设施。

## 核心导出 (dist/)
- `index.ts`: 显式公共导出清单（ADR-0003，禁 export *）
- `core/index.ts`: 核心约束引擎
- `presets/index.ts`: 预设配置
- `context/index.ts`: 上下文管理
- `pretool-use-hook.ts`: provider PreToolUse 执法脚本（stdin JSON → CommandGate block 级 exit 2，fail-open），编译产物 dist/pretool-use-hook.js 随包出厂，provider hook 配置直接指向包内路径（studio#153）

## 目录
| 目录 | 职责 |
|------|------|
| core/ | 约束引擎、检查点验证器、会话管理 |
| gates/ | 质量门 (acceptance, command, contract, performance, review, security) |
| monitoring/ | Execution Trace 收集/分析、上下文追踪 |
| failure/ | 错误分类、失败记录 |
| context/ | 会话管理、token 预算、压缩、知识注入 |
| spec/ | （空目录）@spec 注释检查已删（ADR-0003）；spec 故事见 core/spec/validator + SpecAcceptanceGate |
| cli/commands/ | 24 个 CLI 子命令 |
| tools/ | 工具定义 |

## 依赖关系
- `src/core/` 被所有模块依赖（基础层）
- `src/gates/` 依赖 `src/core/` 类型
- `src/cli/` 依赖所有模块

## 术语

词典（#30 术语裁决；详见 `docs/adr/0002-registry-closed-loop.md`）：

| 术语 | 定义 |
|------|------|
| 插件 | harness 扩展点统称 = hook / checker / 门禁(Gate) / 命令(CLI)；非运行时插件容器——harness 是文件驱动 CLI、无常驻进程 |
| Gate（门禁） | 统一守卫接口 `Gate{id, order, evaluate(ctx)}` → `GateDecision`；统一的是决策协议（id/order/三态），执行细节私有 |
| GateDecision | 三态决策 `deny \| abstain \| ask`；deny 单调（下游不可改回 allow）、ask 枚举预留 fail-closed = deny |
| GateResult | 报告结构（gate/passed/message/details/timestamp/duration），保留为报告层，不作决策 |
| 守卫 guard | 仅 dsh 借鉴语境（工具管线单调守卫），不进入 harness 命名 |
| 回滚 | 分工：版本化回退（单段——yml 数据文件 git 版本化，删段恢复）+ 提案回滚（多段 inverse，挂 #82 D6） |
| 文件驱动 CLI | yml 状态真值 + 一次性进程、无常驻生命周期；故不引 dispose 链（止步档 1） |

## 注意事项
- 公共包，禁止硬编码业务路径
- 约束定义在 `core/constraints/definitions/{iron-laws,guidelines,prompts}.ts`，不应在运行时代码中定义
- `bin/` 只有 CLI 入口发布到 npm
