# src/dashboard

Dashboard 数据模块 — 项目健康度统计和可视化数据。

## 职责

- `stats.ts` — 统计计算（约束违规、测试覆盖率等）
- `data.ts` — 数据聚合和格式化
- `types.ts` — Dashboard 数据类型

## 核心导出

- 统计和数据聚合函数
- Dashboard 数据类型

## 依赖关系

- 被 `src/index.ts` 导出
- 读取 `.harness/` 下的追踪和诊断数据

## 注意事项

- 数据来源是 `.harness/` 目录下的 JSONL 文件
- 统计计算是零 token 的纯数据操作
