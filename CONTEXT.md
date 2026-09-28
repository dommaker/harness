# harness

通用工程约束框架：定标准、查落实、攒知识的家具、治理流程（定位见 ADR-0031）。

## Language

**检查点（checkpoint）**:
项目在 `.harness/checkpoints.yml` 里自己声明的通用验证项（文件/命令/输出/HTTP 等 13 种 check type），由 `CheckpointValidator` 或 `harness validate` 执行。
_Avoid_: 门禁、门控

**门禁（gate）**:
harness 作为标准提供的、代码写死实现的成品质量检查，仅指 `src/gates/` 注册的 6 个（验收/命令/契约/性能/审查/安全），统一三态决策协议。
_Avoid_: 检查点

> 两者分工与判定尺见 ADR-0036。
