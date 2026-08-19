# core/

## 职责
约束引擎核心：check/prompt 二元约束系统（ADR-0001）、生效集合并（effective-constraints）、检查点验证器(CSO/passes-gate)、会话管理、Spec 验证器、项目配置加载。

## 核心导出
- `constraints/` — 约束定义(IRON_LAWS/GUIDELINES/PROMPTS) + 检查引擎(ConstraintChecker) + 拦截器(ConstraintInterceptor) + 缓存(CheckCache：TTL 缓存 + 计数采样，H6/G5 起公开导出) + 注入渲染(injection-renderer) + Agent prompt 渲染(agent-prompt-renderer：trigger 参数化分组渲染，role 路由留 studio，H6/G6)/漂移校验(injection-drift)/使用统计(usage-report)
- `effective-constraints.ts` — `getEffectiveConstraints(projectRoot, {preset?})`：全仓唯一生效集来源（内置 → preset → config.yml 禁用（内置与 custom 同效）→ custom 追加（禁用/已退役的不追加）→ scenes 过滤）；`getMergedConstraintsConfig(projectRoot, {preset?})`：同链路的完整 MergedConstraintsConfig 形状（含 disabled/custom/unknownIds），内置工单 23 优先级规则（--preset 仅在无项目自定义配置时生效），check 命令经此入口；`lintEffectiveConfig` 配置诊断
- `effective-set.ts` — `filterEnabledEntries(knownIds, entries, {onUnknownId})`：约束侧（collect）与门禁侧（throw）共用的 config 条目筛选器
- `validators/` — checkpoints、passes-gate、CSO 验证器
- `session/` — 会话管理
- `spec/validator` — SpecValidator
- `project-config-loader` — 项目配置加载 + 约束合并（mergeConstraints 内含 preset 裁剪：presets/ 纯数据 + 未知名回落 standard，禁用到未知 id 经 effective-set 共享筛选器 collect 模式）

## 依赖关系
- 被所有模块依赖（基础层，无上层依赖）
- 依赖 `src/types/` 类型定义
- 依赖 `src/utils/` 工具函数
- 依赖 `src/monitoring/traces` TraceCollector

## 约定
- 约束定义在 `constraints/definitions/{iron-laws,guidelines,prompts}.ts`，不在运行时代码中定义
- check 层必须带真实 checker（注册表闭环，引用未注册 checker 构建报错）
- Iron Law 违规必须 throw ConstraintViolationError
- 检查器使用单例模式(ConstraintChecker.getInstance())

## 注意事项
- 零 Token 成本：所有分析纯文件操作，无 LLM 调用
- 约束配置支持 .harness/config.yml 自定义合并（preset 真实生效）
- 存在性探测约束（capability_sync/docs_freshness/context_doc_sync）在约定文件缺失时 skip，不计 pass/fail
