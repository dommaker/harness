/**
 * 检查点 command_* 族处理器（工单 23）
 */

import { spawn } from 'child_process';
import { execAsync } from '../../../utils/exec';
import type { CheckpointCheck, CheckResult, CheckpointContext } from '../../../types/checkpoint';

/**
 * 失败时回带的输出末段字节数。
 *
 * 判成败只需要退出码，所以这里刻意不缓冲全量输出：旧写法走 exec（缺省 maxBuffer 1MiB），
 * 被测命令输出超线即被 Node 砍进程并报 `stdout maxBuffer length exceeded`，于是「跑了一堆
 * 输出的成功命令」判成失败——绿测试报成红，且真因被 `命令执行失败: <command>` 这句 message
 * 吞掉（validate 只打 message）。末段留 4KiB 是因为失败摘要正落在输出尾部，够诊断即可。
 */
const FAILURE_TAIL_BYTES = 4096;

/** 按 shell 语义执行命令，只回带退出码与输出末段（不被输出体量左右）。 */
function runForExitCode(command: string, cwd?: string): Promise<{ code: number; tail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true });
    let tail = Buffer.alloc(0);
    const keep = (chunk: Buffer) => {
      const merged = Buffer.concat([tail, chunk]);
      tail = merged.length > FAILURE_TAIL_BYTES ? merged.subarray(merged.length - FAILURE_TAIL_BYTES) : merged;
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => {
      // 被信号杀死时 code 为 null：非零处置，命令没跑完就不算通过
      resolve({ code: code === null ? 1 : code, tail: tail.toString('utf8').trim() });
    });
  });
}

export async function checkCommandSuccess(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
  const command = check.config.command || '';

  try {
    const { code, tail } = await runForExitCode(command, context.workdir);
    if (code === 0) {
      return {
        checkId: check.id,
        passed: true,
        message: `命令执行成功: ${command}`,
        actual: 'exit code 0',
        expected: 'exit code 0',
      };
    }
    return {
      checkId: check.id,
      passed: false,
      message: `命令执行失败: ${command}（退出码 ${code}）`,
      actual: `exit code ${code}`,
      expected: 'exit code 0',
      error: tail ? `输出末段:\n${tail}` : `exit code ${code}`,
    };
  } catch (error) {
    // spawn 自身失败（如 shell 不可用）：文本即诊断，判失败回带
    const detail = error instanceof Error ? error.message : String(error);
    return {
      checkId: check.id,
      passed: false,
      message: `命令执行失败: ${command}`,
      actual: detail,
      expected: 'exit code 0',
      error: detail,
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      checkId: check.id,
      passed: false,
      message: `命令执行失败: ${command}`,
      actual: detail,
      expected,
      error: detail,
    };
  }
}
