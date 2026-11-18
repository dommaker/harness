/**
 * exec 执行协议全链验收（harness#181 第一半）
 *
 * 示例业务检查器 fixtures/public-repo-sanitization.mjs（场景原型 = 下游消费方安全底线
 * public_repo_sanitization，ADR-0032 ①；占位符豁免谓词是模板填参表达不了的业务判定）
 * 走完整链：编写（fixtures 脚本）→ 名册登记（.harness/constraints.yml 写
 * checker: exec + params.command）→ 执行（loadAppConstraints → ConstraintChecker 分发）
 * → 违规上报（证据行进 ConstraintResult，error 级经 checkConstraints 抛
 * ConstraintViolationError——接入现有 severity/channel 体系）。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { loadAppConstraints } from '../app-constraints-loader';
import { ConstraintChecker } from '../constraints/checker';
import { ConstraintViolationError, type ConstraintContext } from '../../types/constraint';
import { createProjectFixture } from '../../test-setup/project-fixture';

const SCRIPT = path.join(
  __dirname, '..', 'constraints', 'checkers', '__tests__', 'fixtures',
  'public-repo-sanitization.mjs',
);

const DIRTY_DOC = [
  '部署参考 /Users/alice/projects/demo 的配置。',
  '占位符写法 /Users/<you>/projects 不算残留。',
  '另一个现场 /home/bob/work/app 也要拦。',
].join('\n');

const CLEAN_DOC = '部署参考 /Users/<you>/projects/demo 的配置。\n';

function constraintsYml(severity: 'error' | 'warning'): string {
  return [
    'constraints:',
    '  - id: app_public_repo_sanitization',
    '    rule: 公开发布仓的受跟踪文本不得残留开发机现场绝对路径',
    '    checker: exec',
    '    params:',
    `      command: 'node "${SCRIPT}" docs/guide.md'`,
    `    severity: ${severity}`,
    '    message: 检出开发机现场路径',
    '',
  ].join('\n');
}

function project(doc: string, severity: 'error' | 'warning'): string {
  return createProjectFixture({
    name: 'exec-chain',
    files: {
      [path.join('.harness', 'constraints.yml')]: constraintsYml(severity),
      'docs/guide.md': doc,
    },
  });
}

describe('exec 业务检查器全链（编写 → 名册登记 → 执行 → 违规上报）', () => {
  it('名册登记：checker: exec + params.command 经加载期校验实例化为 gate 约束', () => {
    const constraints = loadAppConstraints(project(DIRTY_DOC, 'error'));
    expect(constraints).toHaveLength(1);
    expect(constraints[0]).toMatchObject({
      id: 'app_public_repo_sanitization',
      source: 'app',
      channel: 'gate',
      checker: 'exec',
    });
  });

  it('违规上报：检出残留路径 → satisfied=false，证据可归因到文件与命中，占位符豁免', async () => {
    const root = project(DIRTY_DOC, 'error');
    const [constraint] = loadAppConstraints(root);
    const context: ConstraintContext = { operation: 'commit', projectPath: root };

    const result = await new ConstraintChecker().check(constraint, context);
    expect(result.satisfied).toBe(false);
    const text = (result.evidence ?? []).join('\n');
    expect(text).toContain('docs/guide.md');
    expect(text).toContain('/Users/alice/');
    expect(text).toContain('/home/bob/');
    expect(text).not.toContain('<you>');
  });

  it('severity 分发：error 级违规经 checkConstraints 抛 ConstraintViolationError', async () => {
    const root = project(DIRTY_DOC, 'error');
    const [constraint] = loadAppConstraints(root);
    const context: ConstraintContext = { operation: 'commit', projectPath: root };

    await expect(
      new ConstraintChecker().checkConstraints(context, {
        constraints: { [constraint.id]: constraint },
        disabled: [],
      }),
    ).rejects.toBeInstanceOf(ConstraintViolationError);
  });

  it('warning 级违规进 result.warnings、不抛（severity 语义与内置一致）', async () => {
    const root = project(DIRTY_DOC, 'warning');
    const [constraint] = loadAppConstraints(root);
    const context: ConstraintContext = { operation: 'commit', projectPath: root };

    const report = await new ConstraintChecker().collectConstraints(context, {
      constraints: { [constraint.id]: constraint },
      disabled: [],
    });
    expect(report.warningCount).toBe(1);
    expect(report.warnings[0].satisfied).toBe(false);
    expect((report.warnings[0].evidence ?? []).join('\n')).toContain('/Users/alice/');
  });

  it('对象合规（脚本退出码 0）→ 满足', async () => {
    const root = project(CLEAN_DOC, 'error');
    const [constraint] = loadAppConstraints(root);
    const context: ConstraintContext = { operation: 'commit', projectPath: root };

    const result = await new ConstraintChecker().check(constraint, context);
    expect(result.satisfied).toBe(true);
    expect(result.skipped).not.toBe(true);
  });
});

describe('exec 全链 × read-only 策略（D3 P0.5 Phase 1）', () => {
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
  /** 构造器第二参注入策略（红阶段旧构造器忽略第二参，行为断言照样跑） */
  const checkerWithPolicy = (policy: InlinePolicy): ConstraintChecker =>
    new (ConstraintChecker as unknown as new (recorder?: unknown, policy?: InlinePolicy) => ConstraintChecker)(
      undefined,
      policy,
    );
  const roPolicy = (execute?: InlinePolicy['execute']): InlinePolicy => ({
    readOnly: true,
    skipReason: (command) => `--read-only：跳过命令执行（未执行）：${command}`,
    execute: execute ?? (async () => ({ code: 0, signal: null, timedOut: false, stdout: '', stderr: '', truncated: false })),
  });

  const markerCommand = (marker: string): string =>
    `node -e "require('fs').writeFileSync('${marker}','x')"`;

  function markerProject(command: string): string {
    return createProjectFixture({
      name: 'exec-ro-chain',
      files: {
        [path.join('.harness', 'constraints.yml')]: [
          'constraints:',
          '  - id: app_marker',
          '    rule: 写标记文件',
          '    checker: exec',
          '    params:',
          `      command: "${command.replace(/"/g, '\\"')}"`,
          '    severity: error',
          '',
        ].join('\n'),
      },
    });
  }

  it('read-only：checker 构造注入策略 → 三态 skipped、执行缝零调用', async () => {
    const dir = markerProject('npm test');
    const [constraint] = loadAppConstraints(dir);
    let executeCalls = 0;
    const context: ConstraintContext = { operation: 'commit', projectPath: dir };

    const report = await checkerWithPolicy(roPolicy(async () => {
      executeCalls++;
      return { code: 0, signal: null, timedOut: false, stdout: '', stderr: '', truncated: false };
    })).collectConstraints(context, {
      constraints: { [constraint.id]: constraint },
      disabled: [],
    });

    expect(executeCalls).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].skipped).toBe(true);
    expect(report.errors[0].skipReason).toContain('--read-only');
    expect(report.errors[0].satisfied).toBe(true); // fail-open 三态语义，不计 pass/fail
  });

  it('read-only：真实执行路径零副作用（marker 文件不产生）', async () => {
    // 命令写相对路径 MARKER（执行 cwd = 项目根）
    const dir = markerProject(markerCommand('MARKER'));
    const marker = path.join(dir, 'MARKER');
    const [constraint] = loadAppConstraints(dir);
    const context: ConstraintContext = { operation: 'commit', projectPath: dir };

    const result = await checkerWithPolicy(roPolicy()).check(constraint, context);

    expect(result.skipped).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('普通模式 + 注入策略：全链经策略执行缝真实执行一次', async () => {
    const dir = markerProject('npm test');
    const [constraint] = loadAppConstraints(dir);
    const calls: string[] = [];
    const context: ConstraintContext = { operation: 'commit', projectPath: dir };

    const result = await checkerWithPolicy({
      readOnly: false,
      skipReason: (command) => `--read-only：跳过命令执行（未执行）：${command}`,
      execute: async (command) => {
        calls.push(command);
        return { code: 0, signal: null, timedOut: false, stdout: '', stderr: '', truncated: false };
      },
    }).check(constraint, context);

    expect(calls).toEqual(['npm test']);
    expect(result.satisfied).toBe(true);
    expect(result.skipped).not.toBe(true);
  });
});
