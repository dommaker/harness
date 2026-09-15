/**
 * 通用工具模块
 *
 * 提供命令执行的公共函数，减少各子系统重复代码。
 * 约束域谓词不在本模块（harness#137：`normalizeTriggers`/`matchesTrigger` 已迁
 * `core/constraints/triggers.ts`；`isCommandAvailable`/`delay` 双仓零生产消费者，已删）。
 */

import { exec } from 'child_process';
import { promisify } from 'util';

/**
 * Promisified exec
 */
export const execAsync = promisify(exec);

/**
 * 执行命令并返回 stdout（忽略 stderr）
 */
export async function runCommand(command: string, cwd?: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command, {
      cwd,
      maxBuffer: 1024 * 1024, // 1MB buffer
    });
    return stdout.trim();
  } catch {
    return '';
  }
}
