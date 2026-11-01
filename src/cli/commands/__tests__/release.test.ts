/**
 * release 命令测试（O6 + 架构评审候选7）
 *
 * Seam：release(options, io) 公开入口。
 * 隔离面：
 *   - utils/exec 的 execFileAsync（argv 形状，P0.3 起唯一执行缝）→ 按命令前缀分发的
 *     fixture（git/npm/tsc 全部 mock，绝不真执行）；handler 返回 { code, stdout, stderr }
 *     形状，code 非零即 rejection（与 promisify(execFile) 的真实失败形状一致：
 *     err.code 数字退出码、err.stdout/err.stderr 各字段可选）
 *   - fs.existsSync → dist 关键文件与本地 typescript 可执行文件的存在性；
 *     fs.readFileSync → fixture 包 package.json（pkgExists=false 时抛 ENOENT，与真实缺文件行为一致）
 *   - 输出 → 注入 captureIO（不 spyOn(process,'exit') / 断言彩色字符串）
 *
 * 判定结果经返回值外溢：每个前置闸门的失败原因含闸门标识（gate <id>），
 * 测试断言 kind + reason + 「首败即停」（后续闸门副作用未发生）。
 *
 * 测试止于 dry-run 与「发布前闸门」，不覆盖真实 npm version/publish 路径——禁止真发版。
 */

import * as fs from 'fs';
import * as path from 'path';
import { captureIO, type CapturingIO } from '../../../cli/command-contract';
import { execFileAsync } from '../../../utils/exec';
import { release } from '../release';

jest.mock('../../../utils/exec', () => ({
  execFileAsync: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('chalk', () => {
  const id = (s: string) => s;
  const chalkFn = Object.assign(id, {
    gray: id,
    blue: id,
    green: id,
    yellow: id,
    cyan: id,
    bold: id,
    red: id,
  });
  return {
    __esModule: true,
    default: chalkFn,
    gray: id,
    blue: id,
    green: id,
    yellow: id,
    cyan: id,
    bold: id,
    red: id,
  };
});

const mockExecFile = execFileAsync as unknown as jest.Mock;
const mockFs = fs as jest.Mocked<typeof fs>;

const PKG_JSON = JSON.stringify({
  name: '@dommaker/harness',
  version: '0.18.0',
  main: './dist/index.js',
  bin: './bin/harness.js',
  exports: { '.': './dist/index.js' },
});

/** 子进程结果形状：与 release.ts 私有 run helper 的返回/失败语义对齐 */
interface ExecOutcome {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

/**
 * 构造一个子进程失败 outcome：code 缺省 1（非零即失败），stdout/stderr 可分别指定
 * （钉「错误只在 stdout / 只在 stderr」两类假绿病灶）。code 也可传字符串
 * （如 'ENOENT'）模拟无数字退出码的执行失败。
 */
function fail(cmd: string, outcome: ExecOutcome = {}): ExecOutcome {
  return { code: 1, ...outcome };
}

type Override = [prefix: string, handler: (cmd: string) => string | ExecOutcome];

/** 本地 tsc 可执行文件在 execFile 调用串里的识别子串（构建不再走 npx） */
const TSC_INVOCATION = 'typescript/bin/tsc';

function execCommands(): string[] {
  return mockExecFile.mock.calls.map(c => [c[0], ...(c[1] as unknown[])].join(' '));
}

/**
 * 全闸门通过的默认流（master / 已同步 / 干净树 / tsc ok / dist ok /
 * npm version → v0.18.1 / npm view → 0.18.1），overrides 按前缀优先命中。
 * handler 返回字符串 = 成功（stdout 为该串）；返回 ExecOutcome = 完整结果，
 * code 非零时以 promisify(execFile) 的 rejection 形状（err.code/err.stdout/err.stderr）拒绝。
 */
function flow(overrides: Override[] = []): void {
  const dispatch = (c: string): string | ExecOutcome => {
    for (const [prefix, handler] of overrides) {
      if (c.startsWith(prefix) || c.includes(prefix)) return handler(c);
    }
    if (c.startsWith('git rev-parse --abbrev-ref')) return 'master';
    if (c.startsWith('git rev-list --count')) return '0';
    if (c.startsWith('git status --porcelain')) return '';
    if (c.startsWith('git tag -l')) return '';
    if (c.includes(TSC_INVOCATION)) return '';
    if (c.startsWith('npm version')) return 'v0.18.1';
    if (c.startsWith('npm view')) return '0.18.1';
    return '';
  };
  mockExecFile.mockImplementation(((file: string, args: unknown[]) => {
    const out = dispatch([file, ...(Array.isArray(args) ? args : [])].join(' '));
    const o: ExecOutcome = typeof out === 'string' ? { code: 0, stdout: out } : out;
    if (o.code !== 0) {
      const err: any = new Error(`${file} exited with code ${String(o.code)}`);
      err.code = o.code;
      if (o.stdout != null) err.stdout = o.stdout;
      if (o.stderr != null) err.stderr = o.stderr;
      return Promise.reject(err);
    }
    return Promise.resolve({ stdout: o.stdout ?? '', stderr: o.stderr ?? '' });
  }) as never);
}

/** 断言 fail 结果的 reason 定位到指定闸门 */
function gateFail(gate: string) {
  return { kind: 'fail' as const, reason: expect.stringContaining(`gate ${gate}`) };
}

describe('release command', () => {
  let io: CapturingIO;
  let pkgExists: boolean;

  beforeEach(() => {
    jest.clearAllMocks();
    io = captureIO();
    pkgExists = true;

    mockFs.existsSync.mockImplementation((p) => {
      if (String(p).endsWith('package.json')) return pkgExists;
      return true; // dist 关键文件视为存在
    });
    mockFs.readFileSync.mockImplementation(((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('package.json')) {
        if (!pkgExists) {
          // 与真实缺文件行为一致：readFileSync 抛 ENOENT（readPackageJson 据此判缺失）
          const err = new Error(`ENOENT: no such file or directory, open '${String(p)}'`) as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return PKG_JSON;
      }
      return PKG_JSON;
    }) as typeof fs.readFileSync);

    flow();
  });

  test('闸门 1 非包目录：fail 定位 package 闸门，零子进程调用', async () => {
    pkgExists = false;

    const result = await release({}, io);

    expect(result).toEqual(gateFail('package'));
    expect(io.errLines().join('\n')).toContain('Not a package');
    expect(execCommands()).toEqual([]);
  });

  test('闸门 1b package.json 缺 version 字段：fail 定位 version-field 闸门，零子进程调用', async () => {
    mockFs.readFileSync.mockImplementation((() => JSON.stringify({ name: '@dommaker/harness' })) as unknown as typeof fs.readFileSync);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('version-field'));
    expect(io.errLines().join('\n')).toContain('version');
    expect(execCommands()).toEqual([]);
  });

  test('闸门 2 非 master/main 分支：fail 定位 branch 闸门，后续闸门不执行', async () => {
    flow([['git rev-parse --abbrev-ref', () => 'feat/x']]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('branch'));
    expect(io.errText()).toContain('Must be on master or main branch');
    const commands = execCommands();
    expect(commands.some(c => c.startsWith('git fetch'))).toBe(false);
    expect(commands.some(c => c.includes(TSC_INVOCATION))).toBe(false);
  });

  test('D2 闸门 2b git rev-parse 非零：fail branch 闸门（取不到分支证据不猜）', async () => {
    flow([['git rev-parse --abbrev-ref', (c) => fail(c, { code: 128, stderr: 'fatal: not a git repository' })]]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('branch'));
    expect(io.errText()).toContain('current branch');
    expect(execCommands().some(c => c.startsWith('git fetch'))).toBe(false);
  });

  test('闸门 3 落后于远程：fail 定位 remote-sync 闸门', async () => {
    flow([['git rev-list --count', () => '3']]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('remote-sync'));
    expect(io.errText()).toContain('behind origin');
    expect(execCommands().some(c => c.includes(TSC_INVOCATION))).toBe(false);
  });

  test('D2 闸门 3b git fetch 非零：fail remote-sync 闸门（不采信陈旧的 behind 证据，rev-list 不再执行）', async () => {
    flow([['git fetch', (c) => fail(c, { code: 1, stderr: 'fatal: unable to connect to origin' })]]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('remote-sync'));
    expect(io.errText()).toContain('git fetch failed');
    expect(execCommands().some(c => c.startsWith('git rev-list'))).toBe(false);
  });

  test('D2 闸门 3c git rev-list 非零：fail remote-sync 闸门（无法与远程比对即停）', async () => {
    flow([['git rev-list', (c) => fail(c, { code: 128, stderr: `fatal: ambiguous argument 'origin/master'` })]]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('remote-sync'));
    expect(execCommands().some(c => c.includes(TSC_INVOCATION))).toBe(false);
  });

  test('闸门 4 工作树不干净：fail 定位 clean-tree 闸门', async () => {
    flow([['git status --porcelain', () => ' M package.json']]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('clean-tree'));
    expect(io.errText()).toContain('Uncommitted changes');
    expect(execCommands().some(c => c.includes(TSC_INVOCATION))).toBe(false);
  });

  test('D2 闸门 4b git status 非零：fail clean-tree 闸门（取不到树状态不猜干净）', async () => {
    flow([['git status --porcelain', (c) => fail(c, { code: 128, stderr: 'fatal: not a git repository' })]]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('clean-tree'));
    expect(execCommands().some(c => c.includes(TSC_INVOCATION))).toBe(false);
  });

  test('闸门 5 tsc 构建失败：fail 定位 build 闸门', async () => {
    flow([[TSC_INVOCATION, (c) => fail(c, { stderr: 'error TS2304: cannot find name' })]]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('build'));
    expect(io.errText()).toContain('tsc failed');
    expect(io.errText()).toContain('TS2304');
  });

  test('D2 闸门 5b tsc 非零且错误只出现在 stdout：仍 fail build（stderr 为空不误判成功）', async () => {
    flow([[TSC_INVOCATION, (c) => fail(c, { code: 2, stdout: 'error TS2304: cannot find name' })]]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('build'));
    expect(io.errText()).toContain('TS2304');
  });

  test('D2 闸门 5c tsc 执行失败无数字退出码（ENOENT）：仍 fail build，不伪装成功', async () => {
    flow([[TSC_INVOCATION, (c) => fail(c, { code: 'ENOENT' })]]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('build'));
  });

  test('D2 闸门 5d 失败构建首败即停：dist 文件全在场也不触 dist 校验与 npm version（陈旧 dist 不救活）', async () => {
    // 缺省 fs mock 下 dist 关键文件全部视为存在；构建仍必须在 verifyReleaseArtifacts 之前停
    flow([[TSC_INVOCATION, (c) => fail(c, { code: 2, stdout: 'error TS2304' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('build'));
    expect(io.outText()).not.toContain('dist: verified');
    expect(execCommands().some(c => c.startsWith('npm version'))).toBe(false);
  });

  test('D2 闸门 5e 项目本地 typescript 可执行文件缺失：fail-loud 定位 build 闸门，零 npx/零隐式下载', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p).endsWith('package.json')) return true;
      if (String(p).includes(TSC_INVOCATION)) return false;
      return true;
    });

    const result = await release({}, io);

    expect(result).toEqual(gateFail('build'));
    expect(io.errText()).toContain('TypeScript not installed');
    expect(execCommands().some(c => c.includes(TSC_INVOCATION))).toBe(false);
    expect(execCommands().some(c => c.startsWith('npx'))).toBe(false);
  });

  test('闸门 6 dist 关键发布物缺失：fail 定位 dist-artifacts 闸门（不触 npm version）', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p).endsWith('package.json')) return true;
      if (String(p).includes(`${path.sep}dist${path.sep}`)) return false;
      return true;
    });

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('dist-artifacts'));
    expect(io.errText()).toContain('dist missing critical artifacts');
    expect(io.errText()).toContain('dist/index.js');
    expect(execCommands().some(c => c.startsWith('npm version'))).toBe(false);
  });

  test.each([
    ['patch', '0.18.1'],
    ['minor', '0.19.0'],
    ['major', '1.0.0'],
  ] as const)('dry-run %s：ok 且提示目标版本 %s（不触 npm version）', async (bumpType, expected) => {
    const result = await release({ bumpType, dryRun: true }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain(`Dry-run complete. Would publish: @dommaker/harness@${expected}`);
    expect(execCommands().some(c => c.startsWith('npm version'))).toBe(false);
  });

  test('闸门 7 目标 tag 已存在：fail 定位 tag-conflict 闸门（不触 npm version/publish）', async () => {
    flow([['git tag -l', () => 'v0.18.1']]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('tag-conflict'));
    expect(io.errText()).toContain('already exists');
    const commands = execCommands();
    expect(commands.some(c => c.startsWith('npm version'))).toBe(false);
    expect(commands.some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('D2 闸门 7b git tag -l 非零：fail tag-conflict 闸门（无法确认 tag 是否已存在，不继续 bump）', async () => {
    flow([['git tag -l', (c) => fail(c, { code: 1, stderr: 'fatal: bad revision' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('tag-conflict'));
    expect(execCommands().some(c => c.startsWith('npm version'))).toBe(false);
  });

  test('闸门 8 npm version 失败：fail 定位 version-bump 闸门（不触 push）', async () => {
    flow([['npm version', (c) => fail(c, { stderr: 'npm ERR! Version prefix required' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('version-bump'));
    expect(io.errText()).toContain('npm version failed');
    expect(execCommands().some(c => c.startsWith('git push'))).toBe(false);
  });

  test('D2 闸门 8b npm version 非零且错误只出现在 stdout：仍 fail version-bump', async () => {
    flow([['npm version', (c) => fail(c, { code: 1, stdout: 'npm ERR! Version prefix required' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('version-bump'));
    expect(io.errText()).toContain('npm version failed');
    expect(execCommands().some(c => c.startsWith('git push'))).toBe(false);
  });

  test('D2 闸门 8c npm publish 非零：fail npm-publish 闸门，首败即停不触 npm view / gh release', async () => {
    // npm view 照常返回目标版本：凭 view 比对就会假绿，publish 非零必须直接判负
    flow([['npm publish', (c) => fail(c, { code: 1, stderr: 'npm ERR! 403 Forbidden' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('npm-publish'));
    expect(io.errText()).toContain('npm publish failed');
    const commands = execCommands();
    expect(commands.some(c => c.startsWith('npm view'))).toBe(false);
    expect(commands.some(c => c.startsWith('gh release create'))).toBe(false);
    expect(io.outText()).not.toContain('Released @');
  });

  test('闸门 9 git push 失败（非保护分支）：fail 定位 git-push 闸门', async () => {
    flow([['git push origin master', (c) => fail(c, { stderr: 'error: failed to push some refs' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('git-push'));
    expect(io.errText()).toContain('git push failed');
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('D2 闸门 9b git push 非零但 stderr 不含 error 字样：仍 fail git-push（不凭 stderr 文本假绿）', async () => {
    flow([['git push origin master', (c) => fail(c, { code: 1, stderr: 'GH013: Resource not accessible' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('git-push'));
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('D2 成功命令 stderr 有普通警告不被误杀：git push code 0 + 警告 stderr 照常走完发布', async () => {
    flow([
      ['git push origin master', () => ({ code: 0, stdout: '', stderr: 'warning: redirecting to https://github.com/x/y.git' })],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain('✅ git: pushed');
    expect(io.outText()).toContain('Released @dommaker/harness@0.18.1');
  });

  test('D2 闸门 9c git push origin <tag> 非零：fail git-push 闸门，不触 npm publish、不打印 Released', async () => {
    flow([['git push origin v0.18.1', (c) => fail(c, { code: 1, stderr: 'error: dst refspec matches multiple' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('git-push'));
    expect(io.errText()).toContain('git push');
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
    expect(io.outText()).not.toContain('Released @');
  });

  test('D2 git push origin <tag> code 0 + 普通警告 stderr：不误杀，照常发布', async () => {
    flow([
      ['git push origin v0.18.1', () => ({ code: 0, stdout: '', stderr: 'warning: redirecting to https://github.com/x/y.git' })],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain('Released @dommaker/harness@0.18.1');
  });

  test('闸门 10 保护分支且 PR 创建失败：fail 定位 pr-create 闸门', async () => {
    flow([
      ['git push origin master', (c) => fail(c, { stderr: 'GH006: push rejected to protected branch' })],
      ['gh pr create', (c) => fail(c, { stderr: 'could not create pull request' })],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('pr-create'));
    expect(io.errText()).toContain('PR creation failed');
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('保护分支且 PR 创建成功：ok（不走 npm publish，打印后续步骤）', async () => {
    flow([
      ['git push origin master', (c) => fail(c, { stderr: 'GH006: push rejected to protected branch' })],
      ['gh pr create', () => 'https://github.com/x/y/pull/9'],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain('PR created: https://github.com/x/y/pull/9');
    expect(io.outText()).toContain('Next steps');
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('D2 闸门 10b 保护分支 releaseBranch push 非零：fail git-push 闸门，不触 gh pr create', async () => {
    flow([
      ['git push origin master', (c) => fail(c, { stderr: 'GH006: push rejected to protected branch' })],
      ['git push origin release/v0.18.1', (c) => fail(c, { code: 1, stderr: 'error: failed to push some refs' })],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('git-push'));
    expect(execCommands().some(c => c.startsWith('gh pr create'))).toBe(false);
  });

  test('D2 PR 流程 git checkout -b 非零：fail pr-branch 闸门，不继续 releaseBranch push / gh pr create', async () => {
    flow([
      ['git push origin master', (c) => fail(c, { stderr: 'GH006: push rejected to protected branch' })],
      ['git checkout -b', (c) => fail(c, { code: 1, stderr: 'error: a branch named release/v0.18.1 already exists' })],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('pr-branch'));
    const commands = execCommands();
    expect(commands.some(c => c.startsWith('git push origin release/'))).toBe(false);
    expect(commands.some(c => c.startsWith('gh pr create'))).toBe(false);
  });

  test('D2 PR 流程收尾 git checkout 切回原分支非零：fail pr-branch 闸门，不返回 ok', async () => {
    flow([
      ['git push origin master', (c) => fail(c, { stderr: 'GH006: push rejected to protected branch' })],
      ['gh pr create', () => 'https://github.com/x/y/pull/9'],
      ['git checkout master', (c) => fail(c, { code: 1, stderr: 'error: Your local changes would be overwritten' })],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('pr-branch'));
    expect(io.outText()).not.toContain('Next steps');
  });

  test('D2 gh pr create 非零即失败（即使 stdout 有输出）：fail pr-create 闸门', async () => {
    flow([
      ['git push origin master', (c) => fail(c, { stderr: 'GH006: push rejected to protected branch' })],
      ['gh pr create', (c) => fail(c, { code: 1, stdout: 'https://github.com/x/y/pull/9' })],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('pr-create'));
    expect(io.errText()).toContain('PR creation failed');
  });

  test('闸门 11 package.json private=true：fail 定位 private-flag 闸门（不触 npm publish）', async () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      name: '@dommaker/harness',
      version: '0.18.0',
      private: true,
      main: './dist/index.js',
    }));

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('private-flag'));
    expect(io.errText()).toContain('"private": true');
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('闸门 12 npm 版本校验不一致：fail 定位 npm-publish-verify 闸门', async () => {
    flow([['npm view', () => '0.0.1']]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('npm-publish-verify'));
    expect(io.errText()).toContain('npm publish verification failed');
    expect(io.errText()).toContain('Expected 0.18.1, registry has 0.0.1');
  });

  test('D2 闸门 12b npm view 非零即使 stdout 恰为目标版本：fail npm-publish-verify，不触 gh release', async () => {
    // stdout 恰好等于 newVersion：只比 stdout 就会打印 published 并继续，假绿病灶
    flow([['npm view', (c) => fail(c, { code: 1, stdout: '0.18.1' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('npm-publish-verify'));
    expect(io.errText()).toContain('npm publish verification failed');
    expect(execCommands().some(c => c.startsWith('gh release create'))).toBe(false);
    expect(io.outText()).not.toContain('Released @');
  });

  test('D2 npm view code 0 + 普通 stderr 警告 + 正确版本：不误杀，照常发布', async () => {
    flow([['npm view', () => ({ code: 0, stdout: '0.18.1', stderr: 'npm warn deprecated old-registry-flag' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain('npm: published @dommaker/harness@0.18.1');
  });

  test('发布全流程通过：ok，GitHub Release 失败为非致命告警', async () => {
    flow([['gh release create', (c) => fail(c, { stderr: 'gh: could not generate notes' })]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain('Released @dommaker/harness@0.18.1');
    expect(io.outText()).toContain('release may have failed (non-fatal)');
    expect(io.outText()).toContain('npm: published @dommaker/harness@0.18.1');
  });

  test('P0.3：发布编排全经 argv 执行，无 shell 字符串形状', async () => {
    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(mockExecFile).toHaveBeenCalled();
    for (const call of mockExecFile.mock.calls) {
      expect(typeof call[0]).toBe('string');
      expect(Array.isArray(call[1])).toBe(true);
    }
  });

  test('P0.3：publish 前后不读写用户 npm 配置，registry 值不进入任何命令', async () => {
    // 明显假值的 registry 形状（含命令替换形）：即使存在也不得被执行
    flow([['npm config get registry', () => 'https://registry.example-fake.invalid/$(not-a-real-cmd);']]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual({ kind: 'ok' });
    const commands = execCommands();
    expect(commands.some((c) => c.startsWith('npm config'))).toBe(false);
    expect(commands.some((c) => c.includes('registry.example-fake.invalid'))).toBe(false);
    // publish 自带 --registry 指向官方源
    expect(commands.some((c) => c.startsWith('npm publish') && c.includes('--registry https://registry.npmjs.org/'))).toBe(true);
  });

  test('P0.3：dry-run 不触 npm publish / npm config', async () => {
    const result = await release({ bumpType: 'patch', dryRun: true }, io);

    expect(result).toEqual({ kind: 'ok' });
    const commands = execCommands();
    expect(commands.some((c) => c.startsWith('npm publish'))).toBe(false);
    expect(commands.some((c) => c.startsWith('npm config'))).toBe(false);
  });

  test('闸门标识唯一且覆盖全部前置闸门（失败原因可逐闸门断言）', () => {
    // 本文件 mock 了 fs，读源码要走真实 fs
    const source: string = jest.requireActual('fs').readFileSync(path.join(__dirname, '..', 'release.ts'), 'utf-8');
    expect(source).toContain('export async function release');
    const gateIds = [...source.matchAll(/gateFail\('([a-z0-9-]+)'/g)].map(m => m[1]);
    // 同一闸门可有多于一个失败站点（如 build = tsc 缺失 + tsc 非零），唯一性指「不同闸门不共用 id」
    const uniqueGateIds = [...new Set(gateIds)];
    expect(uniqueGateIds.length).toBeGreaterThanOrEqual(12);
    expect(uniqueGateIds).toEqual(expect.arrayContaining([
      'package', 'branch', 'remote-sync', 'clean-tree', 'build', 'dist-artifacts',
      'tag-conflict', 'version-bump', 'git-push', 'pr-create', 'private-flag', 'npm-publish-verify',
    ]));
    expect(source).not.toContain('process.exit');
    // P0.3：子进程一律 argv 形状（execFileAsync），不经 shell 字符串
    expect(source).not.toContain('execSync');
    expect(source).not.toContain('npm config');
    // D2：构建不经 npx（不得隐式下载），步骤判负统一走退出码而非 stderr 文本
    expect(source).not.toContain('npx');
    expect(source).not.toContain('.includes(\'error\')');
  });
});
