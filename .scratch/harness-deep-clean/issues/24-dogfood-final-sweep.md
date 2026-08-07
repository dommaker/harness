Title: 执行:dogfooding 修复 + knip 终扫
Type: task
Status: resolved
Blocked by: 08

## Question

checkpoints.yml no-console 重写(排除 node_modules、语义正确)或删除;pre-commit hook 修 set -e 冲突、移除全量 build/test;config.yml version 戳更新;src/tools/core 嵌套 node_modules/package.json 处置(核实 definitions YAML 引用后);knip 复扫零残留确认;build+jest;独立提交(可分 2-3 提交)。

## Answer

完成:
- checkpoints.yml(本地状态,gitignore):删除坏 no-console 与全量 test-pass 检查点,只留 build-success;理由与时间线记录在文件注释。init 的 DEFAULT_CHECKPOINTS 模板同步移除 no-console(工单 23-A)。
- .git/hooks/pre-commit 重写:修 set -e 与 `$(...)` 捕获冲突(|| CHECK_EXIT=$? 模式);移除 harness validate 全量 build/test 步骤,保留 check --staged + RKB 解法提示 + 零字节检测,符合钩子自身"<3s,全量测试交给 CI"声明。
- .harness/config.yml version 戳 0.12.16 → 0.16.6。
- src/tools/core 嵌套包处置:核实 core/index.ts 仅 import '../types'、无任何文件引用 @dommaker/harness@0.12.13、不在 studio 护栏清单 → 删除 package.json/pnpm-lock.yaml/13MB node_modules(孤儿嵌套依赖)。
- knip 终扫:unused files/deps 清零。残余 1 文件为 templates/node-api/src/index.ts(init 脚手架模板,产品本身);84 个 unused exports 全为误报(bin/harness.js 动态 require 的 CLI 命令 + studio 消费的公开类型面)。
build+jest 全绿。
