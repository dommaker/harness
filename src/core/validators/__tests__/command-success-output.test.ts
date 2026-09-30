/**
 * command_success 判据与输出体量解耦（回归钉）
 *
 * 旧实现走 exec（缺省 maxBuffer 1MiB）：被测命令输出超线即被砍进程并报
 * `stdout maxBuffer length exceeded`，于是**跑成功的命令被判失败**，且 message 只剩
 * 「命令执行失败: <command>」看不见真因。现场：消费方仓全量测试 1.16MiB stdout 撞此坑，
 * pre-push 钩子连烧 10 轮全量测试。判成败只看退出码，输出只回带有界末段。
 */

import { describe, it, expect } from '@jest/globals';
import { checkCommandSuccess } from '../check-handlers/command';
import type { CheckpointCheck, CheckpointContext } from '../../../types/checkpoint';

function check(command: string): CheckpointCheck {
  return { id: 'c-1', type: 'command_success', config: { command } } as CheckpointCheck;
}

const context = { workdir: process.cwd(), projectPath: process.cwd() } as CheckpointContext;

/**
 * 写 n 字节到 stdout 后按 code 退出（0 = 成功命令的常态：又吵又绿）。
 * 用 exitCode 而非 process.exit()：后者对管道写入不 flush 缓冲，末段会被截掉。
 */
function loudExit(code: number, mb: number, marker = ''): string {
  return `node -e 'process.stdout.write("a".repeat(${mb * 1024 * 1024}));process.stdout.write("${marker}");process.exitCode=${code}'`;
}

describe('command_success 不被输出体量左右', () => {
  it('输出 2MiB 且退出 0 → 通过（旧实现在此判失败）', async () => {
    const result = await checkCommandSuccess(check(loudExit(0, 2)), context);

    expect(result.passed).toBe(true);
    expect(result.message).toBe('命令执行成功: ' + loudExit(0, 2));
  });

  it('输出 3MiB 且退出 1 → 失败，message 带退出码', async () => {
    const command = loudExit(1, 3, 'FAIL_SUMMARY_TAIL');
    const result = await checkCommandSuccess(check(command), context);

    expect(result.passed).toBe(false);
    expect(result.message).toContain('退出码 1');
  });

  it('失败时回带输出末段，且体积有界（不缓冲全量）', async () => {
    const result = await checkCommandSuccess(check(loudExit(1, 3, 'LAST_LINE_SUMMARY')), context);

    expect(result.error).toContain('LAST_LINE_SUMMARY');
    expect(result.error!.length).toBeLessThan(8192);
  });

  it('命令不存在 → 失败但不抛（exit 路径归一）', async () => {
    const result = await checkCommandSuccess(check('definitely-not-a-command-xyzzy'), context);

    expect(result.passed).toBe(false);
  });
});
