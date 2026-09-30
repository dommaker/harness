/**
 * harness sync-docs 命令（入口编排，工单 22）
 *
 * 自动同步项目文档：CAPABILITIES.md、CONTEXT.md 检查、CHANGELOG 辅助
 * --check 模式输出结构化信息，供 LLM 或 CI 消费
 *
 * 实现拆分（Phase 3：原 index.ts 611 行单函数按三互斥形态拆开）：
 * - index.ts（本文件）     入口装配：--gate 前置校验 → --compact 分派 → 主流程
 * - main-flow.ts           主流程（扫描/判定/json 与人读报告/写入自愈）+ SyncDocsOptions + 计数源装配
 * - gate.ts                --gate 形态：前置用法校验 + vs HEAD 漂移判定尾部（harness#189）
 * - compact.ts             --compact 形态：CAPABILITIES.md 文件表格折叠为目录条目
 * - project-reader.ts      项目信息读取（package.json/config.yml/源码扫描）
 * - capabilities-syncer.ts CAPABILITIES.md 文件表格格式的对比与维护（能力清单格式解析/计数走 core/constraints/capabilities-parser）
 * - context-syncer.ts      CONTEXT.md 模板生成/发现/过时判定 + 目录导出面采集（harness#142）+ 构造点计数采集（harness#202）
 * - agents-syncer.ts       AGENTS.md 生成
 * - preserve-block.ts      PRESERVE 标记块提取与组合
 * - head-gate.ts           --gate 的 vs HEAD 漂移判定（harness#189）
 */

import { processIO, type CommandIO, type CommandResult } from '../../command-contract';
import { assertGateUsage } from './gate';
import { runCompactSync } from './compact';
import { driftOutcome, runMainSyncFlow } from './main-flow';
import type { SyncDocsOptions } from './main-flow';

export type { SyncDocsOptions } from './main-flow';

/**
 * 同步文档
 */
export async function syncDocs(
  options: SyncDocsOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const projectPath = options.projectPath || process.cwd();
  const isCheck = options.check === true;
  const isJson = options.json === true;

  // --gate（harness#189）：自愈写入 + vs HEAD 漂移判定。与只读/迁移形态互斥
  // （不猜意图）；前置校验先于任何写入（脏用法零落盘）。
  if (options.gate) {
    const usageError = assertGateUsage(options, projectPath);
    if (usageError) return usageError;
  }

  // --compact：一次性迁移，将文件表格折叠为目录条目后直接返回
  if (options.compact) {
    return runCompactSync(projectPath, isJson, driftOutcome(isCheck), io);
  }

  return runMainSyncFlow(options, io);
}
