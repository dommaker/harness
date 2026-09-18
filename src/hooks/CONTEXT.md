# hooks/

## 职责
Harness 运行环境的组合根：一次调用装配起约束检查器、会话管理器与 trace 记录器，并加载项目配置。

ADR-0027（#170）起本层只剩 bootstrap 一个面。原先的通用 hook 管线（`registry` / `pipeline` / `config` / `types` 四文件：注册 → 排序 → 错误隔离 → 采样执行）双仓零生产消费者，整体删除——裁决记录 `docs/adr/0027-hooks-pipeline-surface-trim.md`，事实前提 studio#562（studio 侧 hooks 层删除）。目录名沿用历史，不再表示「提供 hook 能力」。

## 核心导出
- `bootstrapHarness` — 异步组合根（S9：配置异步加载，不阻塞事件循环）；也是 trace 记录器的接线点：`new ConstraintChecker(new TraceCollector({ projectPath }))`（harness#88：core 不上行依赖 monitoring，故由本层接线；#139 收根：两个入口本就收 projectPath，落点随之锚定，不再取 cwd 锚定的 `getTraceCollector()` 单例）
- `bootstrapHarnessSync` — 同形状的同步版，配置走 `readFileSync`，供不支持 top-level await 的环境与 `bootstrapHarness` 失败时的回落路径
- `HarnessBootstrap`（type）— 返回值形状 `{ checker, sessions, projectPath, mergedConstraints }`

## 依赖关系
- 向下依赖：`core/constraints/checker`、`core/project-config-loader`、`context/session-manager`、`monitoring/traces`；类型面只从 `src/types/project-config` 取 `MergedConstraintsConfig`
- 消费方：包根 `src/index.ts` 的 bootstrap 三符号出口，与下游项目的运行环境初始化。生产唯一调用方是 studio（经 studio-shared `runtime/bootstrap.ts`，**无参调用**、只以类型持有 `HarnessBootstrap`）。**harness 内部无生产消费方**——core/cli 侧的调用边已随零消费者清账删除（harness#141 同判据，ADR-0022）

## 约定
- 参数面只有 `projectPath`（缺省 `process.cwd()`）：不给 hook 定义、不给配置表，`hookDefinitions` / `hookConfigs` 与注册闭环语义随管线面一同退场
- 组合根只做装配不做判定，`mergedConstraints` 原样透出，用不用由调用方决定
- 本层无内置 hook 定义，也不再提供 hook 管线能力；provider 侧的 PreToolUse 执法入口是 `src/pretool-use-hook.ts`（门禁 CLI 的另一条路），与本目录无关

## 注意事项
- 无 unload/dispose：`SessionManager` 与 `TraceCollector` 随进程生命周期，本层不提供逆操作（口径同 `src/CONTEXT.md` 术语「文件驱动 CLI」）
- 删除属公共面 breaking：包根不再可达的符号有 4 个值符号（注册表、管线、闭环断言、blocking 映射）与 8 个类型，迁移路径 = 删引用；可达性负钉在 `src/__tests__/public-exports.test.ts`，两道全量清单闸（`public-exports` / `public-type-surface`）的条目已同步收缩
