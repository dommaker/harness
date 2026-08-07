Title: codebase-design:目标模块架构规划
Type: task
Status: resolved
Blocked by: 04, 05

## Question

按 codebase-design 技能(深模块词汇表)规划重构后的目标架构:
1. 模块划分与依赖方向(core / cli / gates / knowledge / monitoring / architecture 的边界与收敛)
2. 三大件(checker.ts / definitions.ts / sync-docs.ts)的拆分设计
3. 需要加深的模块接口与需要消除的浅模块
4. 目录结构的最终形态

## Answer

### 设计原则(按 codebase-design 词汇)

目标:每个模块成为**深模块**(小接口、厚实现),接缝(seam)处即测试面;删除测试(假想删除)不通过现有贡献的浅模块一律合并或删除。全程护栏:studio P0/P1 符号与生成物契约冻结,只改实现不改接口签名。

### 1. 目标分层与依赖方向(严格单向)

```
types(纯类型,零 import)
  └─ utils(叶子工具:exec/file-walk/yaml-cache)
       └─ core(约束引擎/校验器/会话/spec)
            └─ 领域层:knowledge / context / monitoring / gates / failure /
               hooks / safety / agents / architecture / tools / verification /
               evolution / dashboard / llm / presets / sdd / spec / user-model
                 └─ cli(25 命令,懒加载)← bin
```

- **types 反向依赖修复**:Diagnosis/ConstraintProposal 从 monitoring 搬入 types/monitoring-types.ts;failure/types 本就独立,types/index 只做同层再导出。types 成为零 import 纯类型层。
- **core↔monitoring 循环消除**:checker.ts 对 getTraceCollector 的值导入改为可选注入(checker 构造或 checkConstraints 接受 traceCollector 参数,默认不记录);monitoring/constraint-evolver 对 definitions 的导入改为类型导入 + 参数传入约束集。
- **constraints/registry → core 的反依赖**保留但标注(新 constraints 模块是过渡产物,本次不动其职责)。

### 2. 三大件拆分设计

**checker.ts(1169 行 God class)→ 约束检查器注册表**
- 新接缝:`core/constraints/checkers/` 目录,每条约束一个文件(export `ConstraintCheck { id, precondition(ctx), evaluate(ctx) }`),共享 `CheckContext`(git diff/config/CAPABILITIES 只算一次)
- checker.ts 瘦身为编排层:加载注册表 + 分发 + CheckCache 真正生效(git 命令纳入缓存);P0 接口 `constraintChecker.checkConstraints(ctx)` 签名与返回结构冻结
- 兼容别名族(IronLawChecker/checkIronLaw/checkAllIronLaws/ironLawChecker):studio 未引用 → 删除
- CheckContext 解决 git diff×4、config.yml×2 的重复 IO(§5.3)

**definitions.ts(1126 行)→ 按层拆 + 助手收敛**
- `core/constraints/definitions/{iron-laws,guidelines,tips}.ts`,definitions.ts 变薄聚合(保持文件路径不变——studio rule-scanner 正则解析该文件路径与 `key:`/`description:` 字面量,P0 #8)
- 12 个查询助手收敛:保留 P0 的 getAllConstraints/getConstraint/checkConstraint,别名族 getAllLaws/findLawsByTrigger/getLaw/filterLawsBySeverity 删除(studio 未引用)
- 约束对象字段结构冻结(P0 #14)

**sync-docs.ts(1188 行)→ 三个同步器 + 共享读取器**
- `cli/commands/sync-docs/{capabilities-syncer,context-syncer,agents-syncer,project-reader,preserve-block}.ts`
- sync-docs.ts 保留为入口编排;config.yml 只读一次(ProjectReader)
- PRESERVE 块语义与 AGENTS.md 输出格式冻结(P0 #3/32)

### 3. 其余模块深化设计

| 模块 | 现状病灶 | 目标形态 |
|------|---------|---------|
| init.ts(832) | 模板内联+预设重复 | 模板字符串移 templates/ 或 init-templates.ts;PRESETS 统一走 src/presets 单一来源 |
| knowledge.ts CLI(712) | 13 子命令平铺 | cli/commands/knowledge/ 每子命令一文件 |
| audit.ts(697) | 常量+规则+计算混杂 | 规则表外置 audit-rules.ts;computeDimensions 按维度拆 |
| passes-gate.ts(613) | 一类包办 | runner/coverage-parser/evidence/extension-registry 四分(P0 PassesGate.check 冻结) |
| checkpoint.ts(547) | 14 型平铺+output_not_contains bug | 按族拆 check-handlers/{file,command,output,http}.ts;修复 output_* 族真正执行 config.command;P0 CheckpointValidator.getInstance/validate 冻结 |
| constraint-evolver/doctor(572/498) | 巨型规则分支 | 规则表数据化;propose/risk/render 分文件(P1 符号冻结) |
| trace-analyzer+performance-analyzer | 镜像同构 | 抽 analyzer-base(统计/趋势/异常),两者成薄适配器 |
| update-user-model+analyze-sessions | 会话挖掘双实现 | 合并 cli/session-mining/ 共享模块,两命令瘦身为入口 |
| acceptance.ts(493) | 加载+验证+E2E 混杂 | tasks-loader/task-validator/e2e-runner |
| command.ts(444) | 黑名单数据内联 | 黑名单移 command-blacklist.ts 数据模块 |
| check.ts(441) | detect* 助手+渲染混杂 | detect* 移 core 上下文构造器;渲染独立;--preset 真生效或删除该选项 |
| doc-freshness/runner.ts(486) | check type 平铺 | 每 type 一策略文件 |
| import.ts(508) | 4 source 一类 | 每 source 一 importer |

### 4. CLI 启动懒加载

bin/harness.js 改为每个命令 `.action(async (...args) => { const m = require('./commands/xxx'); ... })` 动态 require;--version/--help 不再拉起 164 模块。commander 支持 action 内懒加载。

### 5. 全局配置缓存

ProjectConfigLoader 增加进程级 memoize(config.yml 一次解析多处复用);sync-docs 三处、checker 两处、bootstrap、governance 全部改走加载器。

### 6. typescript 隐式依赖修复

knowledge/primitives/code-structure.ts 的 `import * as ts` 改为函数内动态 require + try/catch 降级(无 typescript 时该 primitive 返回空结果并 warn),消除消费者侧运行时崩溃。

### 7. 删除清单(护栏核对通过)

- src/governance/ 整目录(孤岛+studio 零引用+无 CLI 命令)
- scripts/release.ts(与 cli/release 重复,AGENTS.md 声明不走本地发布)
- bin/harness-knowledge-{capture,check,track}.js(无引用钩子模板)
- zod/@types/glob(已删)、16 死触发器常量、死导出(checkpointValidator/createProjectConfigLoader/getPerformanceCollector)、两个无引用桶
- prompt-injection.ts(@deprecated 已迁 studio-shared;studio 快照确认未引用 ROLE_TRIGGERS)
- checker/definitions 兼容别名族(studio 未引用;唯一例外 IronLawContext 类型保留)
- src/tools/core/ 内嵌 node_modules+package.json(依赖旧版自身的怪异产物;核实 tools/core 常量是否被 definitions YAML 引用后处置)

### 8. dogfooding 修复设计

- checkpoints.yml:no-console checkpoint 重写为 command_success 跑排除 node_modules 的 grep 并期望空输出(或干脆删除该 checkpoint——CLI 产品 635 处合法 console)
- validate 失败 exit 1(非 strict 也返回非零,或 CLI 加 --strict 且 hook 使用)
- pre-commit hook:去掉 set -e 与错误分支的冲突;build/test checkpoint 移出 commit 路径(注释本就声称交给 CI)
- .harness/config.yml version 戳更新;custom-constraints.yml 空文件处置
