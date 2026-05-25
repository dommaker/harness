# core/

## 职责
约束引擎核心：三层约束系统(Iron Laws / Guidelines / Tips)、检查点验证器(CSO/passes-gate)、会话管理、Spec 验证器、项目配置加载。

## 核心导出
- `constraints/` — 约束定义(IRON_LAWS/GUIDELINES/TIPS) + 检查引擎(ConstraintChecker) + 拦截器(ConstraintInterceptor) + 缓存(CheckCache)
- `validators/` — checkpoints、passes-gate、CSO 验证器
- `session/` — 会话管理
- `spec/validator` — SpecValidator
- `project-config-loader` — 项目配置加载 + 约束合并

## 依赖关系
- 被所有模块依赖（基础层，无上层依赖）
- 依赖 `src/types/` 类型定义
- 依赖 `src/utils/` 工具函数
- 依赖 `src/monitoring/traces` TraceCollector

## 约定
- 约束定义在 `constraints/definitions.ts`，不在运行时代码中定义
- Iron Law 违规必须 throw ConstraintViolationError
- 检查器使用单例模式(ConstraintChecker.getInstance())

## 注意事项
- 零 Token 成本：所有分析纯文件操作，无 LLM 调用
- 约束配置支持 .harness/config.yml 自定义合并
