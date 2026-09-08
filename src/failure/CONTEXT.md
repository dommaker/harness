# failure/

## 职责
失败处理：错误分类(可扩展规则)、失败记录(文件存储)。

## 核心导出
- `ErrorClassifier` — 错误分类器(可配置规则)
- `FailureRecorder` — 失败记录器(文件存储)
- `types.ts` — 错误分类/记录类型定义

## 依赖关系
- 依赖 `src/types/` 错误分类/记录类型
- 经包根导出（ADR-0003 显式清单）

## 约定
- 分类规则可扩展(自定义 ErrorClassifierConfig)
- 失败记录存储在 .harness/ 目录
- 不包含业务逻辑，只提供通用能力

## 注意事项
- 分类器基于规则匹配，不调用 LLM
- S4 约束违规处理策略模块（ConstraintViolationHandler / executeWithBlock /
  executeWithCollect / executeWithSafeBoolean）已删除（架构评审候选1）：
  COLLECT 对真实 checker 结构上不可交付（checker 首个铁律违规即 throw，
  handler 的 catch 只能吞证据造假绿）。语义归宿——阻断 = `checkConstraints` 本体，
  收集 = `checker.collectConstraints`（report 直调）；BLOCK/SAFE_BOOLEAN 零生产消费者随迁
