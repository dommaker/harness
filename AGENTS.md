# AGENTS.md

> 本文件由 `harness sync-docs --agents` 自动生成，请勿手改。`<!-- PRESERVE:名称 -->` 与 `<!-- /PRESERVE:名称 -->` 之间的内容在重新生成时原样保留。内容漂移时重新运行该命令更新。

## 项目简介

**@dommaker/harness** — 通用工程约束框架 - 铁律系统、检查点验证、测试门控

## 目录结构

| 目录 | 说明 |
|------|------|
| `.github/` | CI/CD 配置 |
| `.harness/` | harness 配置与运行时状态 |
| `__tests__/` | — |
| `bin/` | 可执行入口/脚本 |
| `docs/` | 项目文档 |
| `src/` | 源码目录 |
| `temp-nonexistent-perf/` | — |
| `templates/` | 项目模板 |

## 常用命令

```bash
npm run dev  # 启动开发环境
npm run build  # 构建
npm test  # 运行测试
npm run lint  # 代码检查
```

## 约束与治理

- 约束清单：`CLAUDE.md` Governance Rules 块

## 知识入口

- 各源码目录的 `CONTEXT.md` 是权威模块文档（现有 13 个），改动代码时同步更新
