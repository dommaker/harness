Title: task:前置准备(基线、锁文件、目录清理)
Type: task
Status: resolved
Blocked by: 02

## Question

执行无需决议的机械性前置工作:
1. 跑通 jest 基线并记录结果(哪些测试在 refactor 前就是红的)
2. 核实并删除 package-lock.json(确认 pnpm 为唯一包管理器后),单独提交
3. 清除 coverage/、temp-nonexistent-perf/ 等非源码目录(git 追踪的部分),单独提交
4. 确认 dist/ 产物由构建生成、不手工维护

## Answer

2026-08-07 完成(部分项在 research 完成前先行落地,均为无决议依赖的机械工作):
1. **jest 基线**:128 套件 / 2167 passed / 8 skipped / 0 failed,全绿(33s)。重构全程以此为绿标准。
2. **双锁裁决**:反向裁决 —— CI 全部 4 个 workflow 与 publish 均用 `npm ci`,node_modules 为 npm 安装;故**保留 package-lock.json,删除 pnpm-lock.yaml**(commit 76a9b66)。
3. **rebuild-index.js / rebuild-studio-index.js**:未被 git 追踪的一次性调试脚本(引用已发布版 KnowledgeStore),无任何引用,已从磁盘删除。
4. **coverage/ / temp-nonexistent-perf/ / docs/**:均未被 git 追踪(本地产物/作者规划文档),无需 git 清理;docs/ 保留(转型蓝图是本次重构的架构北极星)。
5. dist/ 由 `npm run build` 生成,不手工维护。
