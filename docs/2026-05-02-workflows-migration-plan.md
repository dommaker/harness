# @dommaker/workflows → @dommaker/harness 迁移计划

> 日期: 2026-05-02
> 依据: harness-transformation.md §10.8 + §12.1
> 状态: Phase A + B 已完成（2026-05-02）

## 一、背景

`@dommaker/workflows` (v0.0.6) 是从 agent-platform 派生的 npm 包，包含：
- 113 个工具 YAML（87 std + 22 core + 4 ext）
- 25 个工作流 YAML（**已废弃**，O6 Goal 驱动替代）
- 5 个上下文模板
- registry/index.json（29 工具 + 23 工作流条目）

按 §10.8，工具定义并入 harness，工作流 YAML 删除。

## 二、当前 agent-studio 中的 4 处引用

| 文件 | 读取内容 | 用途 |
|------|----------|------|
| `apps/api/src/modules/tools-std/routes.ts` | `tools/std/*.yml` | 工具 CRUD + git 版本历史 |
| `apps/api/src/modules/outputs/routes.ts` | `outputs/` 目录 | 产出文档读写 |
| `apps/api/src/modules/capabilities/routes.ts` | `registry/index.json` | 能力列表 |
| `packages/studio-capability/src/services/capability.service.ts` | `registry/index.json` | 能力同步到 DB |

## 三、已知问题（迁移前就存在）

1. **registry/index.json 硬编码绝对路径** — `path` 字段指向 `/root/projects/agent-platform/...`，npm 安装后不可用
2. **git 版本历史功能** — `tools-std/routes.ts` 的 getGitLog/getGitDiff/getGitFileContent 假设文件在 git repo，但 npm 包不是 git repo
3. **GET /workflows 端点** — 读取已废弃的 workflow YAML

## 四、迁移方案

### Phase A: Harness 侧 — 接收工具定义

**目标**: harness 成为工具定义的唯一来源

#### A1. 复制工具 YAML 到 harness

```
harness/src/tools/definitions/
├── std/          ← 87 个标准工具 YAML
│   ├── backlog/
│   ├── quick/
│   ├── file/
│   ├── patch/
│   ├── project/
│   ├── evolution/
│   ├── verification/
│   ├── design/
│   ├── analysis/
│   └── ...
├── core/         ← 22 个核心工具 YAML
├── ext/          ← 4 个扩展工具 YAML
└── registry.json ← 修复路径后的注册表（相对路径）
```

#### A2. 给 ToolRegistry 加 YAML loader

新增 `src/tools/loader.ts`：
- `loadToolsFromDir(dir: string): ToolDefinition[]` — 扫描目录加载 YAML
- `loadRegistry(registryPath: string)` — 加载并修复 registry.json 路径
- YAML → ToolDefinition 映射规则：
  - `id` → `id`
  - `name` → `name`
  - `description` → `description`
  - `category` → `category`（映射到 ToolCategory: core/std/ext）
  - `inputs` → `parameters`（转换为 JSON Schema）
  - `execute` → 不导入（harness 不执行工具，只注册定义）

#### A3. 导出工具路径

新增 `src/tools/paths.ts`：
```typescript
export function getToolsDir(): string {
  return path.join(__dirname, 'definitions');
}
export function getRegistryPath(): string {
  return path.join(__dirname, 'definitions', 'registry.json');
}
```

#### A4. 修复 registry.json

- 所有 `path` 字段改为相对路径（相对于 definitions/）
- 移除 workflow 条目（23 条，已废弃）
- 保留 tool 条目（29 条）

#### A5. 更新 harness 导出

`src/tools/index.ts` 新增：
```typescript
export * from './loader';
export * from './paths';
```

`package.json` 的 `files` 字段确保 `definitions/` 目录被打包。

### Phase B: Agent-Studio 侧 — 切换引用

#### B1. 更新 tools-std/routes.ts

```diff
- const AGENT_WORKFLOWS_PATH = require.resolve('@dommaker/workflows') ...
+ import { getToolsDir } from '@dommaker/harness';
+ const TOOLS_STD_PATH = path.join(getToolsDir(), 'std');
```

**git 版本历史功能处理**：
- 方案 1（推荐）: 移除 git 版本历史 API（4 个端点），改为 DB 版本记录
- 方案 2: 暂时保留但标注 DEPRECATED，返回空结果
- 理由: 工具定义来自 npm 包（只读），git 历史不再有意义

**GET /workflows 端点**: 移除（工作流 YAML 已废弃）

#### B2. 更新 capabilities/routes.ts

```diff
- const REGISTRY_PATH = require.resolve('@dommaker/workflows') + '/registry/index.json'
+ import { getRegistryPath } from '@dommaker/harness';
+ const REGISTRY_PATH = getRegistryPath();
```

#### B3. 更新 capability.service.ts

```diff
- require.resolve('@dommaker/workflows')
+ import { getRegistryPath } from '@dommaker/harness';
```

#### B4. 更新 outputs/routes.ts

outputs/ 不属于 harness（是 agent-studio 运行时产出），改为本地目录：
```diff
- require.resolve('@dommaker/workflows') + '/outputs'
+ path.join(process.cwd(), '.harness', 'outputs')
```

#### B5. 移除 @dommaker/workflows 依赖

- `apps/api/package.json` 删除 `"@dommaker/workflows": "^0.0.5"`
- `.github/renovate.json` 移除 `@dommaker/workflows` 引用

### Phase C: 清理

#### C1. 不需要迁移的内容

| 内容 | 处理 | 理由 |
|------|------|------|
| 25 个 workflow YAML | 不迁移 | O6 Goal 驱动替代 |
| 5 个 context 模板 | 不迁移 | harness 已有自己的 context/ |
| bin/workflows-cli.js | 不迁移 | 无消费者 |
| workflows/ 目录 | 不迁移 | 已废弃 |
| templates/ 目录 | 不迁移 | 无消费者 |

#### C2. 版本发布

1. harness 发布 patch 版本（如 0.8.4）包含工具定义
2. agent-studio 更新依赖到新版本
3. 验证所有 4 处引用正常工作

## 五、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 工具 YAML 格式与 ToolDefinition 不兼容 | loader 失败 | A2 做好映射，先写测试 |
| registry.json 路径修复不完整 | 能力同步失败 | A4 用脚本批量替换验证 |
| git 版本历史移除影响前端 | UI 报错 | B1 方案 2 先保留端点返回空 |
| outputs/ 路径变更 | 产出文档丢失 | B4 迁移已有数据 |

## 六、前置条件

- [x] harness 已有 `src/tools/` 模块（registry + types + core）
- [x] harness 已导出 tools 模块（`export * from './tools'`）
- [x] harness 需要添加 `yaml` 依赖（已存在：js-yaml ^4.1.1）
- [x] harness package.json `files` 字段需包含 `definitions/`（已改为 build 脚本复制到 dist/）

## 七、预估工作量

| Phase | 内容 | 时间 |
|-------|------|------|
| A | Harness 侧接收工具定义 | 2-3 小时 |
| B | Agent-Studio 切换引用 | 1-2 小时 |
| C | 清理 + 测试 + 发版 | 1 小时 |
| **合计** | | **4-6 小时** |
