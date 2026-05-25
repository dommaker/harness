# evolution/

## 职责
约束自动进化：基于 trace 分析自动生成约束优化提案(autoEvolve)。

## 核心导出
- `auto-evolve.ts` — autoEvolve(): 纯计算 API，基于 trace 分析生成进化提案

## 依赖关系
- 依赖 `src/monitoring/` TraceAnalyzer / ConstraintEvolver
- 依赖 `src/core/constraints/` 约束定义
- 被 `src/cli/commands/flow.ts` CLI 消费(auto-apply)

## 约定
- autoEvolve() 是纯计算函数，不调用 LLM
- 进化提案由 ConstraintEvolver 生成
- 低风险提案可自动应用(flow --auto-apply)

## 注意事项
- 约束退化基于拦截率(不基于日历时间)
- Iron Law: 拦截率 < 5%(≥100 次检查) → guideline
- Guideline: 拦截率 < 30%(≥10 次检查) → tip
