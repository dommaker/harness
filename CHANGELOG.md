# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- （新增功能）

### Changed
- （功能变更）

### Fixed
- （Bug 修复）

## [0.8.4] - 2026-05-01

### Changed

#### 重复代码消除
- 统一 `execAsync` 到 `utils/exec`：15 个文件的重复定义合并为单一来源
- 新增 `normalizeTriggers()` 泛型工具函数，消除 10+ 处 `Array.isArray` 重复模式
- 新增 `delay()` 公共函数，替换 3 处私有 `sleep/delay` 方法

#### 逻辑简化
- `checker.ts`：60 行 `switch` 例外匹配 → `EXCEPTION_FIELD_MAP` 映射表 + `some()` 一行
- `checker.ts`：3 个近似循环 → 提取 `matchesTrigger()` + `recordTrace()` 公共方法
- `interceptor.ts`：触发器规范化 → 复用 `normalizeTriggers`
- `trace-analyzer.ts` / `performance-analyzer.ts`：5 次/3 次遍历统计 → 单次遍历
- `failure/recorder.ts`：`getByType`/`getByLevel` 重复过滤 → 提取 `getFiltered()`

#### 健壮性修复
- 修复 `checker.ts` 中 Guidelines 循环直接引用 `GUIDELINES` 常量的 bug（未使用自定义约束配置）
- 修复 `project-config-loader.ts` 中 `mergeConstraints()` 的 for 循环缩进错误（方法体脱离类作用域）
- 修复 `progressive-loader.ts` 中 `delay` 参数名与导入函数冲突
- 补充 `ConstraintContext` 缺失字段：`isExternalDependency`、`isExplicitInstruction`、`isEmergencyFix`、`isExistingDesign`

#### 性能优化
- `cross-project-checker.ts`：`execSync`（阻塞式）→ 异步 `runCommand`
- `progressive-loader.ts` `processBatch`：并发结果顺序不保证 → worker pool 模式保证输入顺序

#### 代码规范
- `cli/commands/status.ts`：`any` 类型 → `TraceSummary` / `TraceAnomaly`
- `cross-project-checker.test.ts`：更新 mock 从 `child_process` → `utils/exec`
- 合并 10+ 处分散的 `import { exec } + promisify(exec)` 为统一导入

> 净减少约 157 行代码，零编译错误，零测试回归

---

## Recent Commits

- feat: add command CLI for blacklist checking (2026-04-29 23:24:07 +0800)
- feat: add CommandGate for command blacklist (SEC-006) (2026-04-29 23:09:44 +0800)
- fix: remove deprecated command tests (propose, diagnose, traces) (2026-04-29 01:10:46 +0800)
- chore: release v0.8.0 (2026-04-28 23:41:32 +0800)
- docs: decouple Trace section from business logic (2026-04-28 23:39:12 +0800)
- chore: remove docs and specs directories (moved to .gitignore) (2026-04-28 23:37:35 +0800)
- chore: ignore docs directory (2026-04-28 23:36:39 +0800)
- docs: remove deprecated note from README (2026-04-28 23:34:30 +0800)
- refactor(cli): remove deprecated commands (traces, diagnose, propose) (2026-04-28 23:32:26 +0800)
- docs: sync CLI commands to README (2026-04-28 23:23:47 +0800)
- feat(cli): add 5 gate commands - acceptance, performance, security, contract, review (2026-04-28 23:04:33 +0800)
- chore: ignore specs directory in gitignore (2026-04-28 22:56:59 +0800)
- chore: ignore specs/templates 目录 (2026-04-28 22:52:51 +0800)
- feat: 新增覆盖率约束机制 (2026-04-28 22:50:15 +0800)
- test: 覆盖率达标 85.43%！ (2026-04-28 22:39:48 +0800)
- test: 覆盖率提升至 84.8% (2026-04-28 22:34:31 +0800)
- test: 覆盖率提升至 83.93% (2026-04-28 22:29:51 +0800)
- chore: 清理临时测试文件 (2026-04-28 22:21:01 +0800)
- test: 覆盖率提升至 84.17% (2026-04-28 22:20:54 +0800)
- init (2026-04-28 22:11:12 +0800)

---

> 自动生成于 2026-04-30
