/**
 * command_success 判据与输出体量解耦（回归钉）
 *
 * 旧实现走 exec（缺省 maxBuffer 1MiB）：被测命令输出超线即被砍进程并报
 * `stdout maxBuffer length exceeded`，于是**跑成功的命令被判失败**，且 message 只剩
 * 「命令执行失败: <command>」看不见真因。现场：消费方仓全量测试 1.16MiB stdout 撞此坑，
 * pre-push 钩子连烧 10 轮全量测试。判成败只看退出码，输出只回带有界末段。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkCommandSuccess, checkCommandOutput } from '../check-handlers/command';
import type { CommandSuccessCheck, CommandOutputCheck, CheckpointContext } from '../../../types/checkpoint';

function check(command: string): CommandSuccessCheck {
  return { id: 'c-1', type: 'command_success', config: { command } };
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

describe('command_* 处理器 × read-only 策略（D3 P0.5 Phase 1）', () => {
  const markerCommand = (marker: string): string =>
    `node -e "require('fs').writeFileSync('${marker}','x')"`;

  /** 结构化策略字面量：与 CommandExecutionPolicy 同形（不经工厂，红阶段也能编译运行） */
  interface InlinePolicy {
    readOnly: boolean;
    skipReason: (command: string) => string;
    execute: (command: string, cwd: string, timeoutMs: number) => Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      stdout: string;
      stderr: string;
      truncated: boolean;
    }>;
  }
  const roPolicy = (): InlinePolicy => ({
    readOnly: true,
    skipReason: (command) => `--read-only：跳过命令执行（未执行）：${command}`,
    execute: async () => ({ code: 0, signal: null, timedOut: false, stdout: '', stderr: '', truncated: false }),
  });
  const withPolicy = (policy: InlinePolicy): CheckpointContext => {
    const ctx = { workdir: process.cwd(), projectPath: process.cwd() } as CheckpointContext & { commandPolicy: InlinePolicy };
    ctx.commandPolicy = policy;
    return ctx;
  };

  it('command_success read-only：三态 skipped（passed=false + skipReason），不执行零副作用', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ro-cmd-'));
    try {
      const marker = path.join(dir, 'marker');
      const result = await checkCommandSuccess(check(markerCommand(marker)), withPolicy(roPolicy()));

      expect(result.passed).toBe(false);
      // 双转：旧 CheckResult 无 skipped/skipReason 字段，红阶段编译护栏下跑到运行时断言红
      expect((result as { skipped?: boolean }).skipped).toBe(true);
      expect((result as { skipReason?: string }).skipReason).toContain('--read-only');
      expect((result as { skipReason?: string }).skipReason).toContain('writeFileSync');
      expect(result.message).toContain('未执行');
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('command_output read-only：三态 skipped，不执行零副作用', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ro-out-'));
    try {
      const marker = path.join(dir, 'marker');
      const outputCheck: CommandOutputCheck = {
        id: 'c-2',
        type: 'command_output',
        config: { command: markerCommand(marker), expected: 'x' },
      };
      const result = await checkCommandOutput(outputCheck, withPolicy(roPolicy()));

      expect(result.passed).toBe(false);
      expect((result as { skipped?: boolean }).skipped).toBe(true);
      expect((result as { skipReason?: string }).skipReason).toContain('--read-only');
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无策略（库直调默认）：command_success 默认执行，行为不变', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ro-default-'));
    try {
      const marker = path.join(dir, 'marker');
      const result = await checkCommandSuccess(check(markerCommand(marker)), {
        workdir: dir,
        projectPath: dir,
      });
      expect(result.passed).toBe(true);
      expect(fs.existsSync(marker)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
