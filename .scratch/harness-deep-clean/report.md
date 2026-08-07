# harness-deep-clean 重构报告(验收版)

> 分支:`refactor/deep-clean`(未 push,待验收)。基线:jest 128 套件全绿 → 终态 127 套件 / 2130 通过 / 8 skipped / 0 失败(删除的 1 套件属死代码批)。净代码变化:**132 文件,+5455 / −7550(净减 ~2100 行)**。

## 一、变更清单(按工单)

### 删除批(工单 09-12、24)
- 死代码基础批:16 个死触发器常量、3 处死导出(checkpointValidator/core-validators 单例、createProjectConfigLoader 等)、2 个无引用桶(constraints/index、core/spec/index)
- 废弃发布脚本与无引用知识钩子
- governance 孤岛模块整删(10 孤岛模块调研中唯一可删)
- prompt-injection 与 IronLaw 兼容别名族
- zod / @types/glob 零使用依赖;@typescript-eslint/* 无配置依赖
- doc-freshness/auto-fix.ts(零引用)、src/tools/core 孤儿嵌套包(13MB)、dist 过期产物、extractTableFiles 等零调用函数

### 修复批(工单 13、23、24)
- typescript 隐式运行时依赖 → 懒加载降级
- **checkpoint output_\* 族从不执行 config.command 的 bug**(dogfooding no-console 检查点失效根因);expected:'' 按「输出应为空」判定
- validate 检查点失败一律 exit 1(此前非 strict 不退出,钩子/CI 形同虚设)
- pre-commit 钩子:set -e 与 `$(...)` 捕获冲突修复;移除全量 build/test(低内存 OOM 源)
- checkpoints.yml/init 模板:坏 no-console 检查点删除;.harness/config.yml version 戳 0.12.16 → 0.16.6

### 架构批(工单 14-22)
- **分层纠偏**:types 层去反向依赖(Diagnosis/Proposal/failure 类型归位 types/);core↔monitoring 循环消除(trace 记录器注入化 + evolver 约束集参数化)
- **性能**:config.yml 解析进程级 memoize(6 处内联收敛,单次 check 只解析一次);CLI 懒加载(--version 加载模块 173→9);check 流程 git 命令 run 级 memo(4 处 diff 收敛)+ ls-tree 批量化(N 次→1 次)
- **去重**:utils/file-walk(5 处遍历收敛)、capabilities-parser(2 处解析收敛)、cli/session-mining(两会话挖掘命令收敛)、monitoring/analyzer-base(双分析器同构部分收敛)
- **三大件拆分**:
  - definitions.ts 1088 行 → definitions/{iron-laws,guidelines,tips}.ts + 50 行薄聚合(路径与导出面不变,约束 hash 逐字节一致)
  - checker.ts 1163 → 560 行:37 条约束抽入 checkers/ 注册表(ConstraintCheck{id,evaluate(env)} + CheckEnv 接缝)
  - sync-docs.ts 1144 行 → sync-docs/{project-reader,capabilities-syncer,context-syncer,agents-syncer,preserve-block} + 入口编排(PRESERVE 语义冻结,--check 幂等验证)
- checkpoint.ts 534 行 → 编排层 + check-handlers/{file,command,output,http} 四族
- check.ts detect* 族迁 core/constraints/context-builder;--preset 真正接入 applyPreset
- constraint-doctor 诊断规则数据化(DIAGNOSIS_RULES 表)

### 终审(工单 25)
- tsc --noUnusedLocals --noUnusedParameters:61 处诊断清零(41 文件)
- knip:unused files / dependencies 零残留

## 二、新架构说明

**单向分层**(依赖只向下):

```
types(纯类型,零反向 import)
  └─ utils(exec / file-walk / detect-source-roots)
      └─ core(constraints: definitions 三层薄聚合 + checker 编排 + checkers 注册表
               + context-builder + capabilities-parser + checkpoint 编排 + check-handlers)
          └─ 领域层(monitoring/evolution/knowledge/gates/presets/context/...
              经注入与 core 解耦:TraceRecorder 注入、ConstraintLookup 参数化)
              └─ cli(bin 懒加载分发;commands 薄入口;session-mining/sync-docs 子模块)
```

**关键接缝**:
- `ConstraintCheck { id, evaluate(env) }` + `CheckEnv`(context/stagedDiff/stagedDiffNames/srcScan)——新增约束 = 注册表加一个模块,不再改 God class
- `CheckCache` + run 级 memo——单次 check 内 git/扫描 I/O 各一次
- `loadRawProjectConfig`(mtime+size 指纹)——config.yml 全进程解析一次
- checkers/check-handlers 两注册表族同构:编排层只负责分发、例外豁免、trace 记录

**冻结契约**(验证未破坏):constraintChecker.checkConstraints 签名与返回结构;IRON_LAWS/GUIDELINES/TIPS 与 getAllConstraints/getConstraint;约束集合 hash(`harness constraints --json` 拆分前后一致);AGENTS.md PRESERVE 语义;bin CLI 语法。

## 三、studio 迁移说明(单向交付,studio 零改动)

本次对 studio **无破坏性变更**,理由逐项对照 issues/03 护栏:
1. **根入口导出面不变**:60+ 具名符号全部保留;types 搬家均留兼容再导出(failure/types、monitoring 两文件、types/index 显式再导出),`import { ... } from '@dommaker/harness'` 全部可用。
2. **CJS require + Object.keys 内省**(harness-upgrade.ts):根入口仍可 require、导出可枚举——仅新增符号,无删除。
3. **rule-scanner 契约**(P0 #8):`src/core/constraints/definitions.ts` 路径保留(薄聚合)。注:该文件历史上就不含 scanner 正则所需的 `key:` 字面量(现用 `id:`),拆分前后 scanner 行为一致;若 studio 侧希望真正可用,建议后续让 scanner 追读 `definitions/{iron-laws,guidelines,tips}.ts`(需 studio 自行发版)。
4. **package.json version / templates/node-api/.harness / sync-docs PRESERVE**:均未动;version 字段未 bump(按决议统一 ship 时处理)。
5. **CLI 形态**:7 个命令形态与子命令透传不变;懒加载对调用方透明(--version 更快)。
6. **生成物契约**(config.yml version 行、AGENTS.md、CLAUDE.md 标记块、traces.log JSONL、knowledge/):格式全部未变。

**studio 侧唯一建议(非必须)**:upgrade 脚本的内省清单若包含本次删除的符号(governance 模块、prompt-injection 别名族、IronLawChecker 等别名、checkpointValidator 单例等死导出),预期会报「被删 API」——这些经核实 studio 零引用,属预期清理。

## 四、验收建议

- 全套 jest:`npx jest --maxWorkers=2`(127 套件全绿)
- 冒烟:`harness --version / check / check --list / constraints --json / sync-docs --check --agents / kb list` 均已验证
- 死代码:`npx knip`(files/deps 零)、`npx tsc --noEmit --noUnusedLocals --noUnusedParameters`(0 诊断)
- 验收通过后由您统一走一次 ship(bump/publish/push 均按决议未执行)
