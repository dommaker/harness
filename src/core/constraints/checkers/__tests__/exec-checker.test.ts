/**
 * exec 模板（harness#181，ADR-0035 决策 3 探测器来源 exec 档）测试
 *
 * 执行协议：params.command 以 env.projectPath 为 cwd 执行，退出码 0 = 满足、非 0 = 违规，
 * stdout/stderr 行进证据。保护面：超时即杀 + 输出截断（命令失控不拖死检查流程）。
 * 范式同 templated-checkers.test.ts：测面是 ConstraintCheck.evaluate(env)，
 * exec 不吃 git 证据，env 经 buildCheckEnv(context, 'none') 构造。
 */

import { describe, it, expect } from '@jest/globals';
import { execScript } from '../templated/exec';
import { TEMPLATES } from '../index';
import { buildCheckEnv, normalizeCheckOutcome, type CheckEnv, type CheckOutcome } from '../types';
import { createProjectFixture } from '../../../../test-setup/project-fixture';
import type { ConstraintContext } from '../../../../types/constraint';

function makeEnv(projectPath: string): CheckEnv {
  const context: ConstraintContext = { operation: 'commit', projectPath };
  return buildCheckEnv(context, 'none');
}

const passed = (outcome: CheckOutcome): boolean => normalizeCheckOutcome(outcome).satisfied;
const evidenceText = (outcome: CheckOutcome): string =>
  normalizeCheckOutcome(outcome).evidence.join('\n');

describe('exec 模板注册与参数校验', () => {
  it('已注册进 TEMPLATES', () => {
    expect(TEMPLATES.get('exec')).toBe(execScript);
  });

  it('validateParams：command 必填非空字符串', () => {
    expect(execScript.validateParams({}).join()).toContain('command');
    expect(execScript.validateParams({ command: '' }).join()).toContain('command');
    expect(execScript.validateParams({ command: 1 }).join()).toContain('command');
    expect(execScript.validateParams({ command: 'true' })).toEqual([]);
  });

  it('validateParams：timeoutMs 可选，须为正数且不超上限', () => {
    expect(execScript.validateParams({ command: 'true', timeoutMs: '1' }).join()).toContain('timeoutMs');
    expect(execScript.validateParams({ command: 'true', timeoutMs: 0 }).join()).toContain('timeoutMs');
    expect(execScript.validateParams({ command: 'true', timeoutMs: -5 }).join()).toContain('timeoutMs');
    expect(execScript.validateParams({ command: 'true', timeoutMs: 999_999_999 }).join()).toContain('timeoutMs');
    expect(execScript.validateParams({ command: 'true', timeoutMs: 5000 })).toEqual([]);
  });
});

describe('exec evaluate', () => {
  it('退出码 0 → 满足', async () => {
    const dir = createProjectFixture({ name: 'exec-pass' });
    const check = execScript.create('app_x', { command: 'node -e "process.exit(0)"' });
    expect(passed(await check.evaluate(makeEnv(dir)))).toBe(true);
  });

  it('非零退出 → 违规，证据含退出码与 stdout/stderr 行', async () => {
    const dir = createProjectFixture({ name: 'exec-fail' });
    const command = `node -e "console.log('out-line'); console.error('err-line'); process.exit(3)"`;
    const outcome = await execScript.create('app_x', { command }).evaluate(makeEnv(dir));
    expect(passed(outcome)).toBe(false);
    const text = evidenceText(outcome);
    expect(text).toContain('退出码 3');
    expect(text).toContain('out-line');
    expect(text).toContain('err-line');
  });

  it('cwd = env.projectPath（脚本拿到的项目根即约束目标项目）', async () => {
    const dir = createProjectFixture({ name: 'exec-cwd' });
    const command = 'node -e "console.log(process.cwd()); process.exit(1)"';
    const text = evidenceText(await execScript.create('app_x', { command }).evaluate(makeEnv(dir)));
    expect(text).toContain(dir);
  });

  it('超时 → 杀死进程并判违规（命令失控不拖死检查流程）', async () => {
    const dir = createProjectFixture({ name: 'exec-timeout' });
    const check = execScript.create('app_x', {
      command: 'node -e "setInterval(() => {}, 1000)"',
      timeoutMs: 500,
    });
    const outcome = await check.evaluate(makeEnv(dir));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('超时');
  }, 15000);

  it('输出截断保护：超长 stdout/stderr 不整段进证据', async () => {
    const dir = createProjectFixture({ name: 'exec-truncate' });
    const command = `node -e "for (let i = 0; i < 2000; i++) console.log('line-' + i + '-'.repeat(50)); process.exit(1)"`;
    const outcome = await execScript.create('app_x', { command }).evaluate(makeEnv(dir));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('截断');
  });

  it('命令不存在（shell 退出 127）→ 违规而非静默通过', async () => {
    const dir = createProjectFixture({ name: 'exec-enoent' });
    const outcome = await execScript
      .create('app_x', { command: 'definitely-not-a-real-command-xyz' })
      .evaluate(makeEnv(dir));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('退出码 127');
  });
});
