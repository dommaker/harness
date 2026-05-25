# dashboard/

## 职责
仪表盘：统计数据聚合、数据源管理。

## 核心导出
- `types.ts` — Dashboard 类型定义
- `stats.ts` — 统计数据计算
- `data.ts` — 数据源管理

## 依赖关系
- 依赖 `src/monitoring/` 追踪/性能数据
- 依赖 `src/knowledge/` 知识统计
- 被 CLI status 命令消费

## 约定
- 仪表盘数据从 .harness/ 运行时状态读取
- 统计数据纯计算，不调用外部服务

## 注意事项
- 相对较新的模块，功能在持续完善中
