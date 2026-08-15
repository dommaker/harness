# tools/

## 职责
工具定义目录与路径管理：bundled 工具定义目录（`definitions/`，113 个 yml 能力目录）与路径解析。

## 核心导出
- `paths.ts` — 工具路径管理（`getToolsDir` / `getRegistryPath`）

## 依赖关系
- 仅依赖 Node 内置 `path`
- 被 studio 消费（`getRegistryPath` / `getToolsDir`，`capabilities/routes.ts`、`capability.service.ts`）

## 约定
- 工具定义目录路径由 paths 模块解析
- `definitions/` 为静态能力目录，构建时复制到 dist

## 注意事项
- 旧工具注册表/核心工具/加载器/类型定义已随 H1（#40）删除，仅保留路径管理与能力目录
