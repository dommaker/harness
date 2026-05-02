/**
 * harness failure 命令
 *
 * 失败记录管理：list、stats、clear
 */

import chalk from 'chalk';
import * as path from 'path';
import { FailureRecorder } from '../../failure/recorder';

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
    logFile: path.join(base, '.harness', 'failures', 'failures.log'),
  });
}

/**
 * 失败记录列表
 */
export async function failureList(
  options: FailureOptions & { limit?: number; type?: string; level?: string },
): Promise<void> {
  const recorder = getRecorder(options.projectPath);

  let records = await recorder.getHistory();

  if (options.type) {
    records = records.filter(r => r.type === options.type);
  }
  if (options.level) {
    records = records.filter(r => r.level === options.level);
  }
  if (options.limit && options.limit > 0) {
    records = records.slice(-options.limit);
  }

  if (options.json) {
    console.log(JSON.stringify({ total: records.length, records }, null, 2));
    return;
  }

  if (records.length === 0) {
    console.log(chalk.yellow('没有失败记录'));
    return;
  }

  console.log(chalk.red(`📋 失败记录 (${records.length} 条)\n`));
  for (const record of records) {
    const levelColor = record.level === 'L4' ? chalk.red
      : record.level === 'L3' ? chalk.yellow
      : record.level === 'L2' ? chalk.cyan
      : chalk.gray;
    const time = new Date(record.timestamp).toLocaleString();
    console.log(`  ${levelColor(`[${record.level}]`)} ${chalk.bold(record.type)} ${chalk.gray(time)}`);
    console.log(`    ${record.message}`);
  }
}

/**
 * 失败记录统计
 */
export async function failureStats(options: FailureOptions): Promise<void> {
  const recorder = getRecorder(options.projectPath);
  const stats = await recorder.getStats();

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  if (stats.total === 0) {
    console.log(chalk.green('✅ 没有失败记录'));
    return;
  }

  console.log(chalk.red(`📊 失败统计\n`));
  console.log(chalk.bold(`  总计: ${stats.total} 条\n`));

  console.log(chalk.bold('  按类型:'));
  for (const [type, count] of Object.entries(stats.byType)) {
    console.log(`    ${type}: ${count}`);
  }

  console.log(chalk.bold('\n  按等级:'));
  for (const [level, count] of Object.entries(stats.byLevel)) {
    const color = level === 'L4' ? chalk.red : level === 'L3' ? chalk.yellow : chalk.gray;
    console.log(`    ${color(level)}: ${count}`);
  }
}

/**
 * 清空失败记录
 */
export async function failureClear(options: FailureOptions): Promise<void> {
  const recorder = getRecorder(options.projectPath);
  const stats = await recorder.getStats();

  await recorder.clear();

  if (options.json) {
    console.log(JSON.stringify({ cleared: stats.total }));
    return;
  }

  console.log(chalk.green(`✅ 已清空 ${stats.total} 条失败记录`));
}
