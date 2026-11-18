/**
 * harness sync-docs 命令（入口编排，工单 22）
 *
 * 自动同步项目文档：CAPABILITIES.md、CONTEXT.md 检查、CHANGELOG 辅助
 * --check 模式输出结构化信息，供 LLM 或 CI 消费
 *
 * 实现拆分（Phase 3：原 index.ts 611 行单函数按三互斥形态拆开；P2.8 起
 * 采集与判定下沉 core/docs-sync/，本目录只剩入口/编排/输出/写侧/gate/compact）：
 * - index.ts（本文件）     入口装配：--gate 前置校验 → --compact 分派 → 主流程
 * - main-flow.ts           主流程编排（采集/判定调 core/docs-sync/sync-state）+ 计数源装配
 * - sync-output.ts         JSON/人读报告出口（含「未找到 srcDir」提示打印）
 * - sync-writes.ts         写入自愈编排（CAPABILITIES/CONTEXT/AGENTS 落盘）
 * - capabilities-syncer.ts CAPABILITIES.md 写侧（增删行/生成模板；解析与排版判定正本在 core/docs-sync/capabilities-table）
 * - context-syncer.ts      CONTEXT.md 写侧落点（createContextMd 走 scaffold 正本；采集在 core/docs-sync/context-collector）
 * - gate.ts                --gate 形态：前置用法校验 + vs HEAD 漂移判定尾部（harness#189）
 * - compact.ts             --compact 形态：CAPABILITIES.md 文件表格折叠为目录条目（折叠正本在 core/docs-sync/capabilities-table）
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
