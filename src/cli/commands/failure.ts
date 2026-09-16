/**
 * harness failure 命令
 *
 * 失败记录管理：list、stats、clear
 */

import chalk from 'chalk';
import * as path from 'path';
import { FailureRecorder } from '../../failure/recorder';
import { DEFAULT_FAILURE_LOG_FILE } from '../../types/failure';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { numericFlagMessage, parseNumericFlag } from '../../utils/numeric-flag';

export interface FailureOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 输出 JSON 格式 */
  json?: boolean;
}

/**
 * 获取失败记录器
 */
function getRecorder(projectPath?: string): FailureRecorder {
  const base = projectPath || process.cwd();
  return new FailureRecorder({
    logFile: path.join(base, DEFAULT_FAILURE_LOG_FILE),
  });
}

/**
 * 失败记录列表
 */
export async function failureList(
  options: FailureOptions & { limit?: number | string; type?: string; level?: string },
  io: CommandIO = processIO,
): Promise<CommandResult> {
  // CLI 直传时 limit 为 commander 字符串值；程序内调用传 number（候选7：编组在命令函数）。
  // 字符串形先过装配窄化（harness#154）：脏输入 fail-loud 且不构造 recorder（零落盘），
  // 原先 parseInt 出 NaN → falsy → 静默不截断。
  let limit: number | undefined;
  if (typeof options.limit === 'string') {
    const parsed = parseNumericFlag(options.limit, 'int');
    if (!parsed.ok) {
      logError(io, numericFlagMessage('--limit', parsed.raw, 'int'));
      return { kind: 'usage-error', reason: `failure list --limit 非法限制: "${parsed.raw}"` };
    }
    limit = parsed.value;
  } else {
    limit = options.limit;
  }
  const recorder = getRecorder(options.projectPath);

  let records = await recorder.getHistory();

  if (options.type) {
    records = records.filter(r => r.type === options.type);
  }
  if (options.level) {
    records = records.filter(r => r.level === options.level);
  }
  if (limit && limit > 0) {
    records = records.slice(-limit);
  }

  if (options.json) {
    log(io, JSON.stringify({ total: records.length, records }, null, 2));
    return { kind: 'ok' };
  }

  if (records.length === 0) {
    log(io, chalk.yellow('没有失败记录'));
    return { kind: 'ok' };
  }

  log(io, chalk.red(`📋 失败记录 (${records.length} 条)\n`));
  for (const record of records) {
    const levelColor = record.level === 'L4' ? chalk.red
      : record.level === 'L3' ? chalk.yellow
      : record.level === 'L2' ? chalk.cyan
      : chalk.gray;
    const time = new Date(record.timestamp).toLocaleString();
    log(io, `  ${levelColor(`[${record.level}]`)} ${chalk.bold(record.type)} ${chalk.gray(time)}`);
    log(io, `    ${record.message}`);
  }
  return { kind: 'ok' };
}

/**
 * 失败记录统计
 */
export async function failureStats(options: FailureOptions, io: CommandIO = processIO): Promise<CommandResult> {
  const recorder = getRecorder(options.projectPath);
  const stats = await recorder.getStats();

  if (options.json) {
    log(io, JSON.stringify(stats, null, 2));
    return { kind: 'ok' };
  }

  if (stats.total === 0) {
    log(io, chalk.green('✅ 没有失败记录'));
    return { kind: 'ok' };
  }

  log(io, chalk.red(`📊 失败统计\n`));
  log(io, chalk.bold(`  总计: ${stats.total} 条\n`));

  log(io, chalk.bold('  按类型:'));
  for (const [type, count] of Object.entries(stats.byType)) {
    log(io, `    ${type}: ${count}`);
  }

  log(io, chalk.bold('\n  按等级:'));
  for (const [level, count] of Object.entries(stats.byLevel)) {
    const color = level === 'L4' ? chalk.red : level === 'L3' ? chalk.yellow : chalk.gray;
    log(io, `    ${color(level)}: ${count}`);
  }
  return { kind: 'ok' };
}

/**
 * 清空失败记录
 */
export async function failureClear(options: FailureOptions, io: CommandIO = processIO): Promise<CommandResult> {
  const recorder = getRecorder(options.projectPath);
  const stats = await recorder.getStats();

  await recorder.clear();

  if (options.json) {
    log(io, JSON.stringify({ cleared: stats.total }));
    return { kind: 'ok' };
  }

  log(io, chalk.green(`✅ 已清空 ${stats.total} 条失败记录`));
  return { kind: 'ok' };
}
