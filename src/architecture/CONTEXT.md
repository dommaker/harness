# architecture/

## 职责
架构级约束检查：架构约束引擎(规则加载/检查/报告)、跨项目接口契约检查(API 同步/类型一致性/破坏性变更/文档-代码一致性)。

## 核心导出
- `constraint-engine.ts` — ArchitectureEngine: 加载规则(.architect/rules.yml)、执行检查、生成报告
- `cross-project-checker.ts` — CrossProjectChecker: 跨项目依赖检查(异步化)

## 依赖关系
- 依赖 `src/core/` 约束引擎类型
- 依赖 `src/utils/exec` 异步命令执行
- 被 `src/cli/` 架构相关命令消费

## 约定
- 规则由项目提供(.architect/rules.yml)，harness 只提供引擎
- 跨项目检查异步执行(不阻塞主流程)
- 注意与 constraint 模块的类型区分

## 注意事项
- 无 index.ts 统一导出，各模块独立导入
- cross-project-checker 已从 execSync 迁移到异步 runCommand
