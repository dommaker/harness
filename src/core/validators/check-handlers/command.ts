/**
 * 检查点 command_* 族处理器（工单 23）
 */

import { execAsync } from '../../../utils/exec';
import type { CheckpointCheck, CheckResult, CheckpointContext } from '../../../types/checkpoint';

export async function checkCommandSuccess(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const command = check.config.command || '';

  try {
    const { stdout } = await execAsync(command, { cwd: context.workdir });
    return {
      checkId: check.id,
      passed: true,
      message: `命令执行成功: ${command}`,
      actual: stdout.trim(),
      expected: 'exit code 0',
    };
  } catch (error: any) {
    return {
      checkId: check.id,
      passed: false,
      message: `命令执行失败: ${command}`,
      actual: error.message,
      expected: 'exit code 0',
      error: error.message,
    };
  }
}

export async function checkCommandOutput(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const command = check.config.command || '';
  const expected = String(check.config.expected || '');

  try {
    const { stdout } = await execAsync(command, { cwd: context.workdir });
    const actual = stdout.trim();
    const matches = actual.includes(expected);

    return {
      checkId: check.id,
      passed: matches,
      message: matches ? `命令输出匹配: ${expected}` : `命令输出不匹配: ${expected}`,
      actual,
      expected,
    };
  } catch (error: any) {
    return {
      checkId: check.id,
      passed: false,
      message: `命令执行失败: ${command}`,
      actual: error.message,
      expected,
      error: error.message,
    };
  }
}
