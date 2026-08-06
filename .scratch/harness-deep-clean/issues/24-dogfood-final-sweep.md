Title: 执行:dogfooding 修复 + knip 终扫
Type: task
Status: open
Blocked by: 08

## Question

checkpoints.yml no-console 重写(排除 node_modules、语义正确)或删除;pre-commit hook 修 set -e 冲突、移除全量 build/test;config.yml version 戳更新;src/tools/core 嵌套 node_modules/package.json 处置(核实 definitions YAML 引用后);knip 复扫零残留确认;build+jest;独立提交(可分 2-3 提交)。
