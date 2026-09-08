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
- **yml 目录是正本、`registry.json` 是派生索引**（#91 裁决）：二者一致性由 `__tests__/registry.test.ts`
  按 ADR-0009 的 reconcile 形状守（双向集合对照 + 条目 path 指向存在的 yml + `name` 与 yml 内 `name` 一致）。
  新增能力 = 先落 yml，再补 registry 条目，缺一即测试红。**不做 yml schema 校验**——那等于替 studio 定能力契约。
  `rollback` 重名 ×2（std/deploy 与 std/governance）是既有事实，进豁免名单；重名是否合法另票裁决。
- `paths.ts` 单变方**不是**假 seam（#91 裁决）：它是包根公开导出（`src/index.ts`，由 public-exports 测试钉住），
  实际消费方是 studio 外部仓，本仓内无第二调用方属预期形状，留任

## 注意事项
- 旧工具注册表/核心工具/加载器/类型定义已随 H1（#40）删除，仅保留路径管理与能力目录
