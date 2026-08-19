# spec/

## 职责
（空目录）原 @spec 注释规范检查（annotation-checker）已随 ADR-0003 删除。

## 已接线的 spec 故事
- `src/core/spec/validator.ts` — SpecValidator：spec 文档结构/内容验证（CLI `harness spec` 消费）
- `src/gates/acceptance.ts` — SpecAcceptanceGate：验收标准门禁

## 注意事项
- @spec 注释检查若需恢复，应迁移为 ConstraintCheck 注册进闭环注册表（ADR-0003 后续立项），不在本目录重建独立子系统
