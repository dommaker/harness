/**
 * Shell 命令执行工具
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

/**
 * 检查命令是否可用
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execAsync(`which ${command}`);
    return true;
  } catch {
    return false;
  }
}