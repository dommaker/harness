Title: research:源码全景调研(架构、死代码、大文件、性能热点)
Type: research
Status: resolved

## Question

对 harness 源码(排除 node_modules)做全景调研,产出:
1. 模块地图:src/ 各目录职责、模块间依赖方向、入口(bin/cli/index exports)
2. 大文件清单(>500 行)及各自臃肿原因分析
3. 死代码候选:无调用方的导出、未被引用的文件、废弃注释块、闲置常量/工具函数
4. 冗余依赖:package.json 中未使用或可替换的依赖、双锁文件状况
5. 循环依赖与性能热点:同步 IO、重复计算、启动路径上的重加载
6. 测试健康度:128 个测试文件的基线红绿状态
7. 仓库内 harness 自身 dogfooding 配置(.harness/、pre-commit hook)中不合理的部分
Type: research
Status: resolved

## Answer

报告全文见 research-codebase.md。核心数字:33,352 行源码、22 顶层模块、10 个孤岛模块、21 个 >400 行文件、zod 零使用、16 个死触发器常量、core↔monitoring 循环、types 反向依赖、git diff×4/config.yml×6 重复 IO、CLI 急切加载 164 模块、typescript 隐式运行时依赖 bug、no-console checkpoint 三因必败。与工单03 护栏交叉核对:10 孤岛中仅 governance 未被 studio 使用(删除候选);IronLawContext 在 studio 类型导入清单中(别名族中唯一必留)。
