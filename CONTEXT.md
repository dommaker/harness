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

**变更面（mutation surface）**:
改变约束状态的写操作集合（retire/reactivate/disable 等），与只读面（清单、元数据、报告）相对。消费方只能经 harness 公共接口走变更，不直读写 `.harness/` 内部文件；`.harness/` 文件布局是 harness 私产。

**构造点（construction site）**:
仓内源码中 `new X(...)` 直构造某类的位置（工厂封装调用点不算——`openKnowledgeStore()` 内部的一处 `new FileKnowledgeStore(...)` 是一个构造点，它的 N 个调用方不是）。CONTEXT.md 里涉及构造点数量的陈述可用机器可读标记钉住：`<!-- sync-docs:construction-sites X = N -->`（可选 `include: tests` 把测试目录计入），`harness sync-docs --check` 对不符者判 fail 并点名文件与类名；无标记的散文不判。计数口径与判定见 ADR-0039。
