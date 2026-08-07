Title: research:studio 使用面快照(删除护栏)
Type: research
Status: resolved

## Question

扫描 /root/projects/studio 全部代码与脚本,列出其对 harness 的每一个使用点:
1. 调用了哪些 harness CLI 命令(含参数形态)
2. import/require 了 harness 的哪些模块或 API
3. postinstall/prepare 等脚本(scripts/harness-sync.js、harness-coverage.ts 等)依赖 harness 的哪些文件/行为
4. studio 生成物(AGENTS.md 等)依赖 harness 的哪些输出格式
产出快照文档存档于本 effort 目录,作为后续删除裁决的护栏;并标注哪些是"studio 真实需要但尚未显式引入"的功能。

## Answer

快照完成,详见 research-studio-usage.md(50 条护栏清单,分 P0 不可删 / P1 建议留 / P2 可适配)。

关键结论:
- CLI 真实使用 7 命令:init(postinstall 自动跑)、check、sync-docs [--agents/--check]、constraints --json、update-user-model --json、studio harness 任意透传;knowledge audit/index/health 仅文档提及、代码未调用(可安全重构但 CLI 命令面建议保留)
- API import 60+ 符号,最大面是知识引擎(10+ 文件直接 new 并调深层方法)
- 物理结构契约:package.json.version、templates/node-api/.harness、src/core/constraints/definitions.ts 路径、CJS require + ESM import 双模入口
- 生成物契约:.harness/config.yml version 行、AGENTS.md PRESERVE 块、CLAUDE.md HARNESS_CONSTRAINTS 标记、CONTEXT.md 模板占位、traces.log JSONL
- 最脆弱三点:知识引擎构造器签名、package.json/config.yml version 契约、sync-docs --agents 的 PRESERVE 语义

裁决规则:harness 重构时 P0 项不可破坏性变更;P0 文件允许内部重构但对外签名/路径/输出格式保持兼容;删除任何功能前对照本清单。
