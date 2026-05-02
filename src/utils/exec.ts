/**
 * 通用工具模块
 *
 * 提供命令执行、数组规范化、延迟等公共函数，减少各子系统重复代码。
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
    // 使用 execFile 避免命令注入（不通过 shell 解析）
    const { execFile: execFileCb } = await import('child_process');
    const execFileAsync = promisify(execFileCb);
    await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 将单值或数组统一为数组（用于 trigger 等字段）
 */
export function normalizeTriggers<T>(
  value: T | T[] | undefined,
  fallback: T[] = []
): T[] {
  if (value === undefined || value === null) return fallback;
  return Array.isArray(value) ? value : [value];
}

/**
 * 异步延迟
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
