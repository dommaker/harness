/**
 * sync-docs 的 --compact 形态（Phase 3 自 index.ts 拆出，纯移位）
 *
 * 一次性迁移：将 CAPABILITIES.md 文件表格折叠为目录条目后直接返回，
 * 不进主流程的扫描/判定/写入管线。
 */

import chalk from 'chalk';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { compactCapabilitiesContent } from './capabilities-syncer';
import { log, type CommandIO, type CommandResult } from '../../command-contract';

export async function runCompactSync(
  projectPath: string,
  isJson: boolean,
  drift: (reason: string) => CommandResult,
  io: CommandIO,
): Promise<CommandResult> {
  const capsPath = path.join(projectPath, 'CAPABILITIES.md');
  // 只兜「不存在」（existsSync 探测）；读/写失败一律抛出，不报成「不存在」
  if (!existsSync(capsPath)) {
    if (!isJson) log(io, chalk.red('❌ CAPABILITIES.md 不存在，无法折叠'));
    return drift('CAPABILITIES.md 不存在，无法折叠');
  }
  const content = await fs.readFile(capsPath, 'utf-8');
  const compacted = compactCapabilitiesContent(content);
  if (compacted !== content) {
    await fs.writeFile(capsPath, compacted, 'utf-8');
    if (!isJson) log(io, chalk.green('✅ 已将 CAPABILITIES.md 文件表格折叠为目录条目'));
  } else {
    if (!isJson) log(io, chalk.green('✅ CAPABILITIES.md 无需折叠'));
  }
  return { kind: 'ok' };
}
