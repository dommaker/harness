/**
 * sync-docs 主流程（Phase 3 自 index.ts 拆出；ADR-0040 Phase 3 按「采集→判定→出口」拆段）
 *
 * 默认形态：扫描源码模块 → CAPABILITIES.md 两种格式判定 → CONTEXT.md 缺失/漂移
 * → AGENTS.md（--agents）→ json/人读报告 → 写入模式自愈。本文件只剩编排：
 * 采集与判定住 sync-state.ts，JSON/人读出口住 sync-output.ts，写入自愈住
 * sync-writes.ts；--gate 的收尾判定经 `gate.ts` 的 runHeadGateVerdict；
 * --compact 形态不经过本文件（见 compact.ts）。
 */

import chalk from 'chalk';
import { type CapabilityDefinitionSource } from '../../../core/constraints/capabilities-parser';
import { COMMAND_DEFINITIONS } from '../definitions';
import { GATE_DEFINITIONS } from '../../../gates/definitions';
import {
  collectSyncState,
  judgeSyncState,
  type SyncDocsOptions,
} from './sync-state';
import { emitJsonReport, emitHumanReport } from './sync-output';
import { applySyncWrites } from './sync-writes';
import { runHeadGateVerdict } from './gate';
import { log, processIO, type CommandIO, type CommandResult } from '../../command-contract';

export type { SyncDocsOptions } from './sync-state';

/**
 * 能力清单计数源（harness#88）
 *
 * core 的 capabilities-parser 不再值导入定义表（单向分层），命令/门禁计数由
 * cli 侧在此组装后注入；两张表都是纯数据模块（ADR-0002 命令形状单一来源）。
 */
const CAPABILITY_DEFINITIONS: CapabilityDefinitionSource = {
  commands: COMMAND_DEFINITIONS,
  gates: GATE_DEFINITIONS,
};

/**
 * 漂移译成 kind：--check 下判定失败；写入模式下漂移已被修掉 → 退出码面不变（历史行为）
 */
export function driftOutcome(isCheck: boolean): (reason: string) => CommandResult {
  return (reason: string): CommandResult => (isCheck ? { kind: 'fail', reason } : { kind: 'ok' });
}

/**
 * 同步文档主流程（--gate / --compact 之外的默认形态；--gate 复用本流程后接 gate 判定）
 */
export async function runMainSyncFlow(
  options: SyncDocsOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const projectPath = options.projectPath || process.cwd();
  const isCheck = options.check === true;
  const drift = driftOutcome(isCheck);
  const isJson = options.json === true;

  if (!isJson) {
    if (isCheck) {
      log(io, chalk.blue('🔍 检查文档新鲜度...'));
    } else {
      log(io, chalk.blue('📝 同步文档...'));
    }
  }

  // 采集 → 判定
  const state = await collectSyncState(projectPath, options, io, CAPABILITY_DEFINITIONS);
  const verdict = judgeSyncState(state, options);

  // JSON 出口：结构化输出供 LLM 消费
  if (isJson) {
    emitJsonReport(io, state, verdict, options);
    return verdict.hasIssues ? drift('文档不是最新的（详见 --json 输出 issues 字段）') : { kind: 'ok' };
  }

  // 人读出口
  emitHumanReport(io, state, verdict);

  // --gate 时无「无需写入即返回」捷径：sync-docs 查不出的未提交手改也是 vs HEAD 漂移，
  // 必须落到末尾的 gate 判定（票面契约：有 diff 即 fail，不问 diff 来源）。
  if (!verdict.hasIssues && !options.gate) {
    log(io, chalk.green('✅ 所有文档都是最新的'));
    return { kind: 'ok' };
  }

  // 检查模式：只报告，不修改
  if (isCheck) {
    log(io, chalk.red('\n❌ 文档不是最新的，请运行 harness sync-docs 更新'));
    // reason 必须可定位（harness#142）：CI 判红时要直接拿到文件与符号，不靠翻 stdout
    const tableLayoutReason = verdict.hasTableLayoutIssues
      ? `；CAPABILITIES.md 表格排版待收拢（表格内空行 ${state.tableLayout.blankLines} 处、`
        + `空表 ${state.tableLayout.emptyTables} 张）`
      : '';
    return drift(
      verdict.contextDriftReason
        ? `文档不是最新的（CONTEXT.md 与实现漂移：${verdict.contextDriftReason}）${tableLayoutReason}`
        : `文档不是最新的，请运行 harness sync-docs 更新${tableLayoutReason}`
    );
  }

  // 写入模式：更新文档
  await applySyncWrites(io, state, verdict, CAPABILITY_DEFINITIONS);

  // --gate（harness#189）：写入完成后判定被管理文档相对 HEAD 的漂移（判定尾部住 gate.ts）
  if (options.gate) {
    return runHeadGateVerdict(projectPath, options, state.result.contextMissing, io);
  }

  return verdict.hasIssues ? drift('写入模式已修复漂移（历史面：退出码仍为 0）') : { kind: 'ok' };
}
