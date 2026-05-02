# src/presets

预设模块 — 约束配置预设（strict/standard/relaxed）。

## 职责

- `standard.ts` — 三个预设配置：STRICT（全部启用）、STANDARD（全部启用）、RELAXED（仅 Iron Laws）

## 核心导出

- `STRICT_PRESET`, `STANDARD_PRESET`, `RELAXED_PRESET`
- `getPreset()` — 按名称获取预设
- 向后兼容：`STANDARD_IRON_LAWS_CONFIG`, `getIronLawPreset()`

## 依赖关系

- 被 `src/index.ts` 导出
- 被 CLI `init` 命令使用

## 注意事项

- 预设定义约束的启用/禁用状态，不修改约束本身
- 新增约束时需更新所有预设的配置
